import type { NodeError } from '@/lib/adpl/types';
import type { CompiledNode } from '../compiler/types';
import { TimeoutError } from './timeout';
import { CancellationError } from '../cancel/token';

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EPIPE']);

/**
 * 에러를 NodeError 구조로 변환.
 * category:
 *   - timeout: 타임아웃 (재시도 가능)
 *   - transient: 일시적 에러 — network, abort (재시도 가능)
 *   - persistent: 재시도 무의미
 *   - cancellation: 취소 (재시도 대상 아님)
 */
export function classifyError(err: unknown, _node: CompiledNode): NodeError {
  if (err instanceof CancellationError) {
    return {
      code: 'cancelled',
      message: err.reason,
      category: 'cancellation',
    };
  }

  if (err instanceof TimeoutError) {
    return {
      code: 'timeout',
      message: err.message,
      category: 'timeout',
    };
  }

  if (err instanceof Error) {
    const anyErr = err as NodeJS.ErrnoException;

    if (anyErr.code && NETWORK_CODES.has(anyErr.code)) {
      return {
        code: 'network',
        message: err.message,
        category: 'transient',
      };
    }

    if (err.name === 'AbortError') {
      return {
        code: 'aborted',
        message: err.message,
        category: 'transient',
      };
    }

    return {
      code: 'unknown',
      message: err.message,
      category: 'persistent',
    };
  }

  return {
    code: 'unknown',
    message: String(err),
    category: 'persistent',
  };
}
