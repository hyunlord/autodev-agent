import path from 'node:path';
import { PipelineCompiler } from './compiler';
import { StateStore } from './state/store';
import { EventBus } from './events/bus';
import { CancellationToken } from './cancel/token';
import { Scheduler } from './scheduler';
import { RealWorker, WorkerOptions } from './worker';
import { AdapterRegistry } from './adapters/registry';
import { ExecutionContextError } from './worker/context-builder';
import type { ExecutionPlan } from './compiler/types';
import type { PipelineRunState } from './state/types';
import type { TriggerContext } from '@/lib/adpl/types';
import type { SchedulerOptions } from './scheduler/types';

export interface RunInput {
  pipelineYaml: string;
  projectId: string;
  pipelineVersionId: string;
  taskId: string;
  triggerContext: TriggerContext;
  /** Absolute path to the worktree root for this run. Required for adapters that perform side effects. */
  worktreeRoot: string;
}

export interface RunOptions {
  env?: Record<string, string>;
  scheduler?: SchedulerOptions;
  worker?: WorkerOptions;
  /** 컴파일 캐시 사용 여부 (default: true, 실제 캐시는 Compiler 내부에서 관리) */
  useCompileCache?: boolean;
}

export interface RunResult {
  runId: string;
  pipelineVersionId: string;
  status: 'completed' | 'failed' | 'cancelled';
  completedNodes: number;
  failedNodes: number;
  skippedNodes: number;
  cancelledNodes: number;
  totalDurationMs: number;
  compileDurationMs: number;
  executionDurationMs: number;
  state: PipelineRunState;
  plan: ExecutionPlan;
}

export interface RunStatus {
  runId: string;
  status: PipelineRunState['status'];
  nodesCompleted: number;
  nodesFailed: number;
  nodesRunning: number;
  nodesPending: number;
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  startedAt: Date;
  completedAt?: Date;
}

/**
 * ADPL 파이프라인 실행 최상위 API.
 *
 * 사용:
 *   const executor = new PipelineExecutor(
 *     new PipelineCompiler(),
 *     adapterRegistry,
 *     new StateStore(),
 *     new EventBus(),
 *   );
 *   const result = await executor.run({ pipelineYaml, projectId, ... });
 */
export class PipelineExecutor {
  /** 실행 중인 run 의 token 추적 (cancel 용) */
  private activeTokens = new Map<string, CancellationToken>();

  constructor(
    private readonly compiler: PipelineCompiler,
    private readonly registry: AdapterRegistry,
    private readonly store: StateStore,
    private readonly bus: EventBus,
  ) {}

  async run(input: RunInput, options: RunOptions = {}): Promise<RunResult> {
    const totalStart = Date.now();

    if (!path.isAbsolute(input.worktreeRoot)) {
      throw new ExecutionContextError(
        `worktreeRoot must be an absolute path, got: ${input.worktreeRoot}`,
      );
    }

    // 1. Compile — pipelineVersionId 를 sourcePath 로 사용해 캐시 키 안정화
    const compileStart = Date.now();
    const sourcePath =
      options.useCompileCache !== false
        ? `${input.projectId}:${input.pipelineVersionId}`
        : undefined;
    const compileResult = await this.compiler.compile(input.pipelineYaml, sourcePath);
    if (!compileResult.ok) {
      throw new Error(
        `[PipelineExecutor] Compile failed: ${compileResult.errors.map((e) => e.message).join('; ')}`,
      );
    }
    const plan = compileResult.plan;
    const compileDurationMs = Date.now() - compileStart;

    // 2. State 생성
    const state = await this.store.create(plan);

    // 2b. Stage 6 F3 — Resume context 저장 (첫 persist 시 DB 에 함께 직렬화됨).
    //     triggerContext 는 Worker 가 실제 사용하는 값(options.worker?.triggerContext) 우선,
    //     fallback 으로 RunInput.triggerContext.
    const triggerForResume =
      (options.worker?.triggerContext as Record<string, unknown> | undefined) ??
      (input.triggerContext as unknown as Record<string, unknown>);
    await this.store.setResumeContext(state.id, {
      triggerContext: triggerForResume,
      taskId: input.taskId,
      pipelineVersionId: input.pipelineVersionId,
      projectId: input.projectId,
      worktreeRoot: input.worktreeRoot,
    });

    // 3. Cancellation token (run 당 하나)
    const token = new CancellationToken();
    this.activeTokens.set(state.id, token);

    try {
      // 4. Worker + Scheduler 조립
      const workerOptions: WorkerOptions = {
        ...options.worker,
        env: options.worker?.env ?? options.env,
        worktreeRoot: options.worker?.worktreeRoot ?? input.worktreeRoot,
      };
      const worker = new RealWorker(this.registry, this.bus, workerOptions);

      const scheduler = new Scheduler(
        plan,
        state,
        this.store,
        worker,
        this.bus,
        token,
        options.scheduler ?? {},
      );

      // 5. 실행
      const execStart = Date.now();
      const schedResult = await scheduler.run();
      const executionDurationMs = Date.now() - execStart;

      return {
        runId: state.id,
        pipelineVersionId: input.pipelineVersionId,
        status: schedResult.status,
        completedNodes: schedResult.completedNodes,
        failedNodes: schedResult.failedNodes,
        skippedNodes: schedResult.skippedNodes,
        cancelledNodes: schedResult.cancelledNodes,
        totalDurationMs: Date.now() - totalStart,
        compileDurationMs,
        executionDurationMs,
        state: (await this.store.get(state.id))!,
        plan,
      };
    } finally {
      // run 종료 후 반드시 정리 (예외 발생해도)
      this.activeTokens.delete(state.id);
    }
  }

  /**
   * Stage 6 F3 — Resume a previously persisted run.
   *
   * Prerequisites: `this.store` must already contain the restored state for `input.runId`
   * (typically created by `StateStore.restore(runId)` before constructing this Executor).
   * The YAML passed here should correspond to the same pipelineVersionId recorded in
   * state, otherwise node pathIds may mismatch.
   *
   * Flow:
   *  1. Validate state + required resume context fields (triggerContext, worktreeRoot).
   *  2. Compile the YAML into an ExecutionPlan.
   *  3. Mark any node still in `running` as `failure` with code `ORPHANED_ON_RESUME`
   *     (worker crashed mid-execution; we cannot safely re-execute side-effectful nodes).
   *  4. Persist the orphan markings once.
   *  5. Build worker+scheduler with `resumeMode: true` and run — scheduler seeds from
   *     pending-with-satisfied-deps, completed/failed are untouched.
   */
  async resumeRun(input: { runId: string; pipelineYaml: string }): Promise<RunResult> {
    const totalStart = Date.now();

    const state = await this.store.get(input.runId);
    if (!state) {
      throw new Error(`RESUME_STATE_MISSING: ${input.runId}`);
    }
    if (!state.triggerContext) {
      throw new Error(`RESUME_MISSING_TRIGGER: runId=${input.runId}`);
    }
    if (!state.worktreeRoot) {
      throw new Error(`RESUME_MISSING_WORKTREE_ROOT: runId=${input.runId}`);
    }
    if (!path.isAbsolute(state.worktreeRoot)) {
      throw new ExecutionContextError(
        `worktreeRoot must be an absolute path, got: ${state.worktreeRoot}`,
      );
    }

    // 1. Compile — reuse pipelineVersionId for cache stability when available
    const compileStart = Date.now();
    const sourcePath = state.pipelineVersionId
      ? `${state.projectId ?? ''}:${state.pipelineVersionId}`
      : undefined;
    const compileResult = await this.compiler.compile(input.pipelineYaml, sourcePath);
    if (!compileResult.ok) {
      throw new Error(
        `[PipelineExecutor.resumeRun] Compile failed: ${compileResult.errors.map((e) => e.message).join('; ')}`,
      );
    }
    const plan = compileResult.plan;
    const compileDurationMs = Date.now() - compileStart;

    // 2. Orphan running nodes → failure (ORPHANED_ON_RESUME)
    let orphanedCount = 0;
    for (const [nodeId, nodeState] of state.nodes.entries()) {
      if (nodeState.status === 'running') {
        await this.store.updateNode(input.runId, nodeId, () => ({
          status: 'failure',
          completedAt: new Date(),
          error: {
            code: 'ORPHANED_ON_RESUME',
            message:
              'Node was running when worker crashed; marked failed to prevent duplicate side effects.',
            category: 'persistent',
          },
        }));
        orphanedCount++;
      }
    }
    if (orphanedCount > 0) {
      await this.store.persist(input.runId);
    }

    // 3. Cancellation token
    const token = new CancellationToken();
    this.activeTokens.set(input.runId, token);

    try {
      // 4. Worker + Scheduler 조립 (resumeMode)
      const workerOptions: WorkerOptions = {
        triggerContext: state.triggerContext,
        worktreeRoot: state.worktreeRoot,
      };
      const worker = new RealWorker(this.registry, this.bus, workerOptions);

      const scheduler = new Scheduler(
        plan,
        state,
        this.store,
        worker,
        this.bus,
        token,
        { resumeMode: true },
      );

      // 5. 실행
      const execStart = Date.now();
      const schedResult = await scheduler.run();
      const executionDurationMs = Date.now() - execStart;

      return {
        runId: state.id,
        pipelineVersionId: state.pipelineVersionId ?? '',
        status: schedResult.status,
        completedNodes: schedResult.completedNodes,
        failedNodes: schedResult.failedNodes,
        skippedNodes: schedResult.skippedNodes,
        cancelledNodes: schedResult.cancelledNodes,
        totalDurationMs: Date.now() - totalStart,
        compileDurationMs,
        executionDurationMs,
        state: (await this.store.get(state.id))!,
        plan,
      };
    } finally {
      this.activeTokens.delete(input.runId);
    }
  }

  /**
   * 실행 중인 run 취소.
   * 없거나 이미 종료된 run 은 no-op.
   */
  cancel(runId: string, reason: string): void {
    const token = this.activeTokens.get(runId);
    if (!token || token.isCancelled) return;

    token.cancel(reason);
    this.bus.emit({
      type: 'run.cancelled',
      timestamp: new Date(),
      runId,
      reason,
    });
  }

  /** 상태 조회 (요약). */
  async getStatus(runId: string): Promise<RunStatus | null> {
    const state = await this.store.get(runId);
    if (!state) return null;

    const count = (s: string) =>
      Array.from(state.nodes.values()).filter((n) => n.status === s).length;

    return {
      runId: state.id,
      status: state.status,
      nodesCompleted: count('success'),
      nodesFailed: count('failure'),
      nodesRunning: count('running'),
      nodesPending: count('pending'),
      totalCostUsd: state.totalCostUsd,
      totalTokensIn: state.totalTokensIn,
      totalTokensOut: state.totalTokensOut,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
    };
  }

  /** 전체 state 조회 (디버깅용). */
  async getState(runId: string): Promise<PipelineRunState | null> {
    return this.store.get(runId);
  }

  /** 현재 cancel 가능한 활성 run 수. */
  activeRunCount(): number {
    return this.activeTokens.size;
  }
}
