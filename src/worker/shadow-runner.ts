import { runLegacyPipeline } from './pipeline';
import { PipelineExecutor } from '@/lib/adpl/engine/executor';
import { PipelineCompiler } from '@/lib/adpl/engine/compiler';
import { StateStore } from '@/lib/adpl/engine/state/store';
import { EventBus } from '@/lib/adpl/engine/events/bus';
import { AdapterRegistry } from '@/lib/adpl/engine/adapters/registry';
import { db } from '@/lib/db/client';
import { tasks, pipelineVersions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { ensureDefaultPipelineVersion } from '@/lib/adpl/legacy-bridge';
import { nanoid } from 'nanoid';
import { resolve } from 'path';
import { recordComparison } from './shadow-comparator';
import type { LegacyResult, ShadowResult } from './shadow-comparator';
import type { EmitFn } from './pipeline-types';
import type { TriggerContextBase } from '@/lib/adpl/types';

type TaskRow = typeof tasks.$inferSelect;

export async function runShadow(
  task: TaskRow,
  rawEmit: EmitFn,
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<void> {
  const startedAt = Date.now();
  const projectId = task.projectId ?? '';

  // legacy promise 먼저 시작 (await 없이)
  const legacyPromise = runLegacyPipeline(task.id, rawEmit, signal).then(
    (): LegacyResult => ({ ok: true, durationMs: Date.now() - startedAt }),
    (err: unknown): LegacyResult => ({
      ok: false,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    }),
  );

  // shadow promise 곧바로 시작
  const shadowController = new AbortController();
  const shadowPromise = runPhasePShadow(task, emit, shadowController.signal).then(
    (result): ShadowResult => ({
      ok: true,
      durationMs: Date.now() - startedAt,
      finalStatus: result.status,
    }),
    (err: unknown): ShadowResult => ({
      ok: false,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    }),
  );

  // legacy 결과 await (사용자에게 돌아가는 것)
  const legacyResult = await legacyPromise;

  // legacy 완료 후 30초 유예 → shadow abort
  const gracePeriod = setTimeout(() => shadowController.abort(), 30_000);

  // shadow 결과 대기
  const shadowResult = await shadowPromise;
  clearTimeout(gracePeriod);

  // comparator 기록
  await recordComparison(task.id, projectId, legacyResult, shadowResult);

  emit({
    type: 'log',
    level: 'info',
    message: `[shadow] legacy=${legacyResult.ok ? 'ok' : 'fail'} shadow=${shadowResult.ok ? 'ok' : 'fail'}`,
  });
}

async function runPhasePShadow(
  task: TaskRow,
  emit: EmitFn,
  signal: AbortSignal,
): Promise<{ status: string }> {
  if (signal.aborted) return { status: 'cancelled' };

  let pipelineVersionId = task.pipelineVersionId;
  if (!pipelineVersionId) {
    pipelineVersionId = await ensureDefaultPipelineVersion(task);
  }

  const version = db.select().from(pipelineVersions)
    .where(eq(pipelineVersions.id, pipelineVersionId))
    .get();
  if (!version) {
    throw new Error(`pipeline_version not found: ${pipelineVersionId}`);
  }

  const worktreeRoot = resolve(task.projectDir ?? process.cwd());

  const triggerContext: TriggerContextBase = {
    triggerId: nanoid(),
    type: 'task_created',
    firedAt: new Date().toISOString(),
  };

  const bus = new EventBus();
  bus.on('*', (event) => {
    emit({ type: 'log', level: 'info', message: `[shadow:phase_p:${event.type}]` });
  });

  const executor = new PipelineExecutor(
    new PipelineCompiler(),
    new AdapterRegistry(),
    new StateStore(),
    bus,
  );

  // AbortSignal → promise race (executor는 CancellationToken 사용, AbortSignal 미지원)
  const abortPromise = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('shadow aborted by grace period timeout')), { once: true });
  });

  const runPromise = executor.run({
    pipelineYaml: version.pipelineYaml,
    projectId: task.projectId ?? '',
    pipelineVersionId,
    taskId: task.id,
    triggerContext,
    worktreeRoot,
  }).then((result) => ({ status: result.status }));

  // suppress potential orphaned rejection if abortPromise wins the race
  runPromise.catch(() => {});

  return Promise.race([runPromise, abortPromise]);
}
