import type { RetryPolicy, NodeError } from '@/lib/adpl/types';
import type { CompiledNode } from '../compiler/types';
import type { CancellationToken } from '../cancel/token';
import type { NodeSpecBase } from '@/lib/adpl/types';

/** 재시도 가능한 에러 카테고리 */
const RETRYABLE_CATEGORIES = new Set<NodeError['category']>(['transient', 'timeout']);

/**
 * 재시도 여부 판단.
 * - error 없거나 cancellation: false
 * - retryPolicy 없거나 maxAttempts <= 1: false (1 = 초기 1회, 재시도 없음)
 * - currentAttempt >= maxAttempts: false
 * - error.category 가 재시도 불가(persistent 등): false
 */
export function shouldRetry(
  node: CompiledNode,
  error: NodeError | undefined,
  currentAttempt: number,
): boolean {
  if (!error) return false;
  if (error.category === 'cancellation') return false;
  if (!RETRYABLE_CATEGORIES.has(error.category)) return false;

  const spec = node.spec as NodeSpecBase;
  const retry = spec.retryPolicy;
  if (!retry || retry.maxAttempts <= 1) return false;
  if (currentAttempt >= retry.maxAttempts) return false;

  return true;
}

/**
 * Backoff 대기 시간 계산 (ms).
 * - retryNum: 몇 번째 재시도인지 (1 = 첫 번째 재시도)
 * - initialDelay / maxDelay 는 seconds 단위 → ms 변환
 * - 기본: exponential, initialDelay=1s, maxDelay=60s
 */
export function calcBackoff(config: RetryPolicy, retryNum: number): number {
  const initialMs = (config.initialDelay ?? 1) * 1000;
  const maxMs = (config.maxDelay ?? 60) * 1000;
  const mode = config.backoff ?? 'exponential';

  let ms: number;
  switch (mode) {
    case 'fixed':
      ms = initialMs;
      break;
    case 'linear':
      ms = initialMs * Math.max(1, retryNum);
      break;
    case 'exponential':
    default:
      ms = initialMs * Math.pow(2, Math.max(0, retryNum - 1));
      break;
  }

  return Math.min(ms, maxMs);
}

/**
 * CancellationToken 호환 sleep.
 * cancel 되면 즉시 resolve (retry loop 가 다음 이터레이션에서 cancellation 감지).
 */
export async function sleepWithCancel(ms: number, token: CancellationToken): Promise<void> {
  if (ms <= 0) return;
  return new Promise<void>((resolve) => {
    let unsub: (() => void) | null = null;
    const timer = setTimeout(() => {
      unsub?.();
      resolve();
    }, ms);
    unsub = token.onCancel(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
