import type { Worker } from './types';
import type { ExecutionPlan } from '../compiler/types';
import type { PipelineRunState } from '../state/types';
import type { CancellationToken } from '../cancel/token';
import type { NodeOutput } from '@/lib/adpl/types';

export interface MockWorkerBehavior {
  defaultResult?: NodeOutput;
  nodeResults?: Record<string, NodeOutput | ((nodeId: string) => NodeOutput | Promise<NodeOutput>)>;
  delayMs?: number;
  onExecute?: (nodeId: string) => void;
}

export class MockWorker implements Worker {
  private _executeCount = 0;
  private _executedNodes: string[] = [];

  constructor(private behavior: MockWorkerBehavior = {}) {}

  async execute(
    nodeId: string,
    _plan: ExecutionPlan,
    _state: PipelineRunState,
    token: CancellationToken,
  ): Promise<NodeOutput> {
    this._executeCount++;
    this._executedNodes.push(nodeId);
    this.behavior.onExecute?.(nodeId);

    if (this.behavior.delayMs && this.behavior.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.behavior.delayMs);
        token.onCancel(() => {
          clearTimeout(timer);
          reject(new Error('cancelled'));
        });
      }).catch(() => {
        // 취소 시 reject 삼킴
      });

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
    }

    const nodeResult = this.behavior.nodeResults?.[nodeId];
    if (nodeResult !== undefined) {
      return typeof nodeResult === 'function' ? await nodeResult(nodeId) : nodeResult;
    }

    return this.behavior.defaultResult ?? { status: 'success', data: null };
  }

  get executeCount(): number {
    return this._executeCount;
  }

  get executedNodes(): string[] {
    return this._executedNodes.slice();
  }

  reset(): void {
    this._executeCount = 0;
    this._executedNodes = [];
  }
}
