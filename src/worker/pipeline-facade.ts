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
import { buildTriggerContext } from './context-builder';
import { DbEventSink } from '@/lib/adpl/engine/events/subscribers/db-event-sink';

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

/**
 * Stage 6 F3 — Resume a persisted Phase P pipeline run from its last checkpoint.
 *
 * 진입 지점. `runId` 는 persist 된 PipelineRunState 의 key.
 *
 * Error taxonomy:
 *  - `PHASE_P_RESUME_FAILED` — 복원 단계 실패 (state 없음, trigger 없음, task/version 조회 실패 등)
 *  - `PHASE_P_EXECUTOR_FAILED` — 복원 이후 실행 단계 실패
 *
 * tasks 테이블 업데이트(resume 시작 시):
 *  - `resumedFromRunId = runId`
 *  - `resumeCount = resumeCount + 1`
 *  - `lastResumedAt = now`
 *  - `status = 'resumed'`
 */
export async function resumePhasePPipeline(runId: string, rawEmit: EmitFn): Promise<void> {
  // Step 1: Restore state (standalone try — 실패 시 taskId 없어 wrapEmit/failTask 불가)
  let store;
  let state;
  try {
    store = await StateStore.restore(runId);
    state = await store.get(runId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    rawEmit({ type: 'log', level: 'error', message: `[PHASE_P_RESUME_FAILED] ${msg}` });
    return;
  }

  if (!state) {
    rawEmit({ type: 'log', level: 'error', message: `[PHASE_P_RESUME_FAILED] state empty for runId=${runId}` });
    return;
  }
  const taskId = state.taskId;
  if (!taskId) {
    rawEmit({
      type: 'log',
      level: 'error',
      message: `[PHASE_P_RESUME_FAILED] state has no taskId (runId=${runId})`,
    });
    return;
  }

  // 이후 로그는 taskId 컨텍스트로 write 가능.
  const emit = wrapEmit(taskId, rawEmit);

  // Step 2: task + pipelineVersion 조회
  let versionId: string | null | undefined = state.pipelineVersionId;
  try {
    const taskRow = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (taskRow && !versionId) {
      versionId = taskRow.pipelineVersionId;
    }
  } catch (err) {
    failTask(taskId, emit, 'PHASE_P_RESUME_FAILED', err instanceof Error ? err.message : String(err));
    return;
  }

  if (!versionId) {
    failTask(taskId, emit, 'PHASE_P_RESUME_FAILED', `no pipelineVersionId for runId=${runId}`);
    return;
  }

  let version;
  try {
    version = db.select().from(pipelineVersions).where(eq(pipelineVersions.id, versionId)).get();
  } catch (err) {
    failTask(taskId, emit, 'PHASE_P_RESUME_FAILED', err instanceof Error ? err.message : String(err));
    return;
  }

  if (!version) {
    failTask(taskId, emit, 'PHASE_P_RESUME_FAILED', `pipelineVersion not found: ${versionId}`);
    return;
  }

  // Step 3: Executor 조립 + tasks 테이블 resume 메타데이터 갱신
  const bus = new EventBus();
  bus.on('*', (event) => {
    emit({ type: 'log', level: 'info', message: `[phase_p:${event.type}]` });
  });

  // Stage 6 F5 — Observability sink: persist every event to pipeline_events.
  // Resume path knows runId up front, so DbEventSink uses it as fallback.
  const dbSink = new DbEventSink(runId, (err) =>
    emit({
      type: 'log',
      level: 'warn',
      message: `[OBSERVABILITY_DB_FAIL] ${err instanceof Error ? err.message : String(err)}`,
    }),
  );
  dbSink.attach(bus);

  const executor = new PipelineExecutor(
    new PipelineCompiler(),
    new AdapterRegistry(),
    store,
    bus,
  );

  try {
    const currentTask = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    const nextResumeCount = (currentTask?.resumeCount ?? 0) + 1;
    const nowIso = new Date().toISOString();
    db.update(tasks)
      .set({
        status: 'resumed',
        resumedFromRunId: runId,
        lastResumedAt: nowIso,
        resumeCount: nextResumeCount,
        updatedAt: nowIso,
      })
      .where(eq(tasks.id, taskId))
      .run();
  } catch {
    // non-critical; 실패 시 로그만
    emit({ type: 'log', level: 'warn', message: `[resume] tasks row update failed for ${taskId}` });
  }

  // Step 4: resumeRun 실행
  try {
    const result = await executor.resumeRun({
      runId,
      pipelineYaml: version.pipelineYaml,
    });

    const success = result.status === 'completed';
    try {
      db.update(tasks)
        .set({ status: success ? 'completed' : 'failed', updatedAt: new Date().toISOString() })
        .where(eq(tasks.id, taskId))
        .run();
    } catch { /* non-critical */ }

    emit({ type: 'task_complete', success, summary: `Phase P pipeline resumed → ${result.status}` });
  } catch (err) {
    failTask(taskId, emit, 'PHASE_P_EXECUTOR_FAILED', err instanceof Error ? err.message : String(err));
  } finally {
    dbSink.detach();
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

  // Part B: version fetch
  let version;
  try {
    version = db.select().from(pipelineVersions)
      .where(eq(pipelineVersions.id, pipelineVersionId))
      .get();
  } catch (err) {
    failTask(taskId, emit, 'PHASE_P_PIPELINE_VERSION_FETCH_FAILED', err instanceof Error ? err.message : String(err));
    return;
  }
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

  // Stage 6 F5 — Observability sink. runId is allocated inside executor.run()
  // (StateStore.create), so we attach with a placeholder fallback. Every actual
  // EngineEvent already carries `runId` on EventBase, so DbEventSink prefers
  // that over the fallback when it persists.
  const dbSink = new DbEventSink('unknown', (err) =>
    emit({
      type: 'log',
      level: 'warn',
      message: `[OBSERVABILITY_DB_FAIL] ${err instanceof Error ? err.message : String(err)}`,
    }),
  );
  dbSink.attach(bus);

  const executor = new PipelineExecutor(
    new PipelineCompiler(),
    new AdapterRegistry(),
    new StateStore(),
    bus,
  );

  const taskTriggerCtx = buildTriggerContext(task);

  try {
    const result = await executor.run({
      pipelineYaml: version.pipelineYaml,
      projectId: task.projectId ?? '',
      pipelineVersionId,
      taskId,
      triggerContext,
      worktreeRoot,
    }, {
      worker: { triggerContext: taskTriggerCtx },
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
  } finally {
    dbSink.detach();
  }
}
