import type { ExecutionPlan, CompiledNode } from '../compiler/types';
import type { PipelineRunState } from '../state/types';
import type { NodeOutput, NodeSpecBase } from '@/lib/adpl/types';
import type { CancellationToken } from '../cancel/token';
import type { Worker } from '../scheduler/types';
import { AdapterRegistry } from '../adapters/registry';
import type { EventBus } from '../events/bus';
import { withTimeout } from './timeout';
import { classifyError } from './error-classifier';
import { shouldRetry, calcBackoff, sleepWithCancel } from './retry-policy';
import { buildExecutionContext } from './context-builder';

export interface WorkerOptions {
  /** env secrets (settings.allowedEnvKeys 에 나열된 키 → 값) */
  env?: Record<string, string>;
  /** Absolute path to worktree root passed to ExecutionContext */
  worktreeRoot?: string;
  /** Adapter 미등록 시 throw 대신 failure 반환 (default: false = throw) */
  lenientOnMissingAdapter?: boolean;
}

/**
 * 실제 Worker 구현.
 * Scheduler 가 호출. retry loop 를 내부에서 처리해 Scheduler 관점에선 1회 호출 = 최종 결과.
 *
 * 책임 분리:
 * - Scheduler: state 전이, node.ready/started/completed 이벤트
 * - Worker: adapter 호출, context 조립, timeout, retry, node.retry 이벤트
 */
export class RealWorker implements Worker {
  constructor(
    private readonly registry: AdapterRegistry,
    private readonly bus: EventBus,
    private readonly options: WorkerOptions = {},
  ) {}

  async execute(
    nodeId: string,
    plan: ExecutionPlan,
    state: PipelineRunState,
    token: CancellationToken,
  ): Promise<NodeOutput> {
    const node = plan.nodes.get(nodeId);
    if (!node) {
      return {
        status: 'failure',
        error: {
          code: 'node_not_found',
          message: `Node "${nodeId}" not found in plan`,
          category: 'persistent',
        },
      };
    }

    let adapter;
    try {
      adapter = this.registry.get(node.spec.type);
    } catch (err) {
      if (this.options.lenientOnMissingAdapter) {
        return {
          status: 'failure',
          error: {
            code: 'adapter_not_registered',
            message: `No adapter for type "${node.spec.type}"`,
            category: 'persistent',
          },
        };
      }
      throw err;
    }

    const spec = node.spec as NodeSpecBase;
    const timeoutSec = spec.timeout ?? adapter.defaultTimeout();
    const timeoutMs = timeoutSec * 1000;

    let currentAttempt = 0;

    while (true) {
      currentAttempt++;

      if (token.isCancelled) {
        return {
          status: 'cancelled',
          error: {
            code: 'cancelled',
            message: token.reason,
            category: 'cancellation',
          },
        };
      }

      let output: NodeOutput;
      try {
        const context = buildExecutionContext(node, plan, state, this.options.env, this.options.worktreeRoot);
        output = await withTimeout(
          adapter.execute(node.spec, context, {
            cancellationToken: token,
            eventBus: this.bus,
            timeoutMs,
          }),
          timeoutMs,
          `Node "${nodeId}" timed out after ${timeoutMs}ms`,
          token,
        );
      } catch (err) {
        output = {
          status: 'failure',
          error: classifyError(err, node),
        };
      }

      if (output.status === 'success') return output;
      if (output.status === 'cancelled') return output;

      if (!shouldRetry(node, output.error, currentAttempt)) {
        return output;
      }

      const retryPolicy = spec.retryPolicy!;
      const backoffMs = calcBackoff(retryPolicy, currentAttempt);

      this.bus.emit({
        type: 'node.retry',
        timestamp: new Date(),
        runId: state.id,
        nodeId,
        attempt: currentAttempt + 1,
        reason: output.error?.message ?? 'retrying',
      });

      await sleepWithCancel(backoffMs, token);
    }
  }
}
