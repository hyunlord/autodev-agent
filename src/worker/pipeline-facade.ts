import { runLegacyPipeline } from './pipeline';
import { runShadow } from './shadow-runner';
import { PipelineExecutor } from '@/lib/adpl/engine/executor';
import { PipelineCompiler } from '@/lib/adpl/engine/compiler';
import { StateStore } from '@/lib/adpl/engine/state/store';
import { EventBus } from '@/lib/adpl/engine/events/bus';
import { AdapterRegistry } from '@/lib/adpl/engine/adapters/registry';
import { db } from '@/lib/db/client';
import { tasks, events, pipelineVersions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { ensureDefaultPipelineVersion } from '@/lib/adpl/legacy-bridge';
import { nanoid } from 'nanoid';
import { resolve } from 'path';
import type { EmitFn } from './pipeline-types';
import type { TriggerContextBase } from '@/lib/adpl/types';

type TaskRow = typeof tasks.$inferSelect;

function wrapEmit(taskId: string, rawEmit: EmitFn): EmitFn {
  return (event) => {
    rawEmit(event);
    try {
      db.insert(events).values({
        id: nanoid(),
        taskId,
        type: event.type,
        data: JSON.stringify(event),
        createdAt: new Date().toISOString(),
      }).run();
    } catch { /* DB write failed — non-critical */ }
  };
}

function failTask(taskId: string, emit: EmitFn, code: string, message: string): void {
  emit({ type: 'log', level: 'error', message: `[${code}] ${message}` });
  try {
    db.update(tasks)
      .set({ status: 'failed', updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, taskId))
      .run();
  } catch { /* non-critical */ }
}

export async function runPipeline(
  taskId: string,
  rawEmit: EmitFn,
  signal?: AbortSignal,
): Promise<void> {
  const emit = wrapEmit(taskId, rawEmit);

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) {
    rawEmit({ type: 'log', level: 'error', message: `Task ${taskId} not found` });
    return;
  }

  const mode: string = task.pipelineMode ?? 'legacy';

  switch (mode) {
    case 'legacy':
      return runLegacyPipeline(taskId, rawEmit, signal);

    case 'phase_p':
      return runPhasePPipeline(task, emit);

    case 'shadow':
      return runShadow(task, rawEmit, emit, signal);

    default:
      failTask(taskId, emit, 'UNKNOWN_PIPELINE_MODE', `unknown pipeline_mode: ${mode}`);
      return;
  }
}

async function runPhasePPipeline(task: TaskRow, emit: EmitFn): Promise<void> {
  const { id: taskId } = task;

  // Part A: ensureDefault 전용 try-catch
  let pipelineVersionId = task.pipelineVersionId;
  if (!pipelineVersionId) {
    try {
      pipelineVersionId = await ensureDefaultPipelineVersion(task);
      await db
        .update(tasks)
        .set({ pipelineVersionId, updatedAt: new Date().toISOString() })
        .where(eq(tasks.id, taskId))
        .run();
    } catch (err) {
      failTask(taskId, emit, 'ENSURE_DEFAULT_FAILED', err instanceof Error ? err.message : String(err));
      return;
    }
  }

  // Part B: version fetch — null 체크만 (throw 없음)
  const version = db.select().from(pipelineVersions)
    .where(eq(pipelineVersions.id, pipelineVersionId))
    .get();
  if (!version) {
    failTask(taskId, emit, 'PHASE_P_PIPELINE_VERSION_NOT_FOUND', `pipeline_version not found: ${pipelineVersionId}`);
    return;
  }

  // Part C: executor 전용 try-catch
  const worktreeRoot = resolve(task.projectDir ?? process.cwd());

  const triggerContext: TriggerContextBase = {
    triggerId: nanoid(),
    type: 'task_created',
    firedAt: new Date().toISOString(),
  };

  const bus = new EventBus();
  bus.on('*', (event) => {
    emit({ type: 'log', level: 'info', message: `[phase_p:${event.type}]` });
  });

  const executor = new PipelineExecutor(
    new PipelineCompiler(),
    new AdapterRegistry(),
    new StateStore(),
    bus,
  );

  try {
    const result = await executor.run({
      pipelineYaml: version.pipelineYaml,
      projectId: task.projectId ?? '',
      pipelineVersionId,
      taskId,
      triggerContext,
      worktreeRoot,
    });

    const success = result.status === 'completed';
    try {
      db.update(tasks)
        .set({ status: success ? 'completed' : 'failed', updatedAt: new Date().toISOString() })
        .where(eq(tasks.id, taskId))
        .run();
    } catch { /* non-critical */ }

    emit({ type: 'task_complete', success, summary: `Phase P pipeline ${result.status}` });
  } catch (err) {
    failTask(taskId, emit, 'PHASE_P_EXECUTOR_FAILED', err instanceof Error ? err.message : String(err));
  }
}
