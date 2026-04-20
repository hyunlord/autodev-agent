import { PipelineCompiler } from './compiler';
import { StateStore } from './state/store';
import { EventBus } from './events/bus';
import { CancellationToken } from './cancel/token';
import { Scheduler } from './scheduler';
import { RealWorker, WorkerOptions } from './worker';
import { AdapterRegistry } from './adapters/registry';
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
    const state = this.store.create(plan);

    // 3. Cancellation token (run 당 하나)
    const token = new CancellationToken();
    this.activeTokens.set(state.id, token);

    try {
      // 4. Worker + Scheduler 조립
      const workerOptions: WorkerOptions = {
        ...options.worker,
        env: options.worker?.env ?? options.env,
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
        state: this.store.get(state.id)!,
        plan,
      };
    } finally {
      // run 종료 후 반드시 정리 (예외 발생해도)
      this.activeTokens.delete(state.id);
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
  getStatus(runId: string): RunStatus | null {
    const state = this.store.get(runId);
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
  getState(runId: string): PipelineRunState | null {
    return this.store.get(runId);
  }

  /** 현재 cancel 가능한 활성 run 수. */
  activeRunCount(): number {
    return this.activeTokens.size;
  }
}
