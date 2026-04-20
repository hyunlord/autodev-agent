import type { NodeSpec, NodeOutput } from '@/lib/adpl/types';
import type {
  NodeAdapter,
  ExecutionContext,
  ExecutionOptions,
  ValidationResult,
} from './types';

export interface MockBehavior {
  /** 지연 (ms). 0 = 즉시 */
  delayMs?: number;
  /** 결과 설정 */
  result?:
    | { kind: 'success'; data?: unknown }
    | { kind: 'failure'; error: { code: string; message: string; category?: string } };
  /** 실행 시 호출되는 side-effect callback (테스트 검증용) */
  onExecute?: (spec: NodeSpec, context: ExecutionContext) => void;
  /** 완전 커스텀 동작. 있으면 다른 옵션 무시 */
  executeCallback?: (
    spec: NodeSpec,
    context: ExecutionContext,
    options: ExecutionOptions,
  ) => Promise<NodeOutput>;
}

/**
 * 테스트용 범용 adapter.
 * 실제 외부 호출 없이 설정된 behavior 에 따라 동작.
 */
export class MockAdapter implements NodeAdapter {
  public readonly type: string;
  private behavior: MockBehavior;
  private _executeCount = 0;
  private _lastContext: ExecutionContext | null = null;
  private _lastSpec: NodeSpec | null = null;

  constructor(init: { type: string; behavior?: MockBehavior }) {
    this.type = init.type;
    this.behavior = init.behavior ?? { result: { kind: 'success' } };
  }

  defaultTimeout(): number {
    return 30;
  }

  validate(_spec: NodeSpec): ValidationResult {
    return { valid: true };
  }

  async execute(
    spec: NodeSpec,
    context: ExecutionContext,
    options: ExecutionOptions,
  ): Promise<NodeOutput> {
    this._executeCount++;
    this._lastSpec = spec;
    this._lastContext = context;

    this.behavior.onExecute?.(spec, context);

    if (this.behavior.executeCallback) {
      return this.behavior.executeCallback(spec, context, options);
    }

    if (this.behavior.delayMs && this.behavior.delayMs > 0) {
      await this.sleep(this.behavior.delayMs, options);
    }

    const result = this.behavior.result ?? { kind: 'success' as const };

    if (result.kind === 'failure') {
      return {
        status: 'failure',
        error: {
          code: result.error.code,
          message: result.error.message,
          category: (result.error.category ?? 'persistent') as import('@/lib/adpl/types').ErrorCategory,
        },
      };
    }

    return {
      status: 'success',
      data: result.data,
    };
  }

  private async sleep(ms: number, options: ExecutionOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      options.cancellationToken.onCancelled(() => {
        clearTimeout(timer);
        reject(new Error('cancelled'));
      });
    });
  }

  get executeCount(): number {
    return this._executeCount;
  }

  get lastContext(): ExecutionContext | null {
    return this._lastContext;
  }

  get lastSpec(): NodeSpec | null {
    return this._lastSpec;
  }

  reset(): void {
    this._executeCount = 0;
    this._lastContext = null;
    this._lastSpec = null;
  }

  setBehavior(behavior: MockBehavior): void {
    this.behavior = behavior;
  }
}
