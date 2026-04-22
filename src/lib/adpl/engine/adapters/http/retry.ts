import type { HttpNodeSpec } from '@/lib/adpl/types/nodes/http';

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

// Cap Retry-After to prevent indefinite blocking
export const MAX_RETRY_AFTER_MS = 60_000;

export function getMaxAttempts(spec: HttpNodeSpec): number {
  const explicit = spec.retryPolicy?.maxAttempts;
  if (explicit !== undefined) return explicit;

  const method = (spec.method ?? 'GET').toUpperCase();
  if (IDEMPOTENT_METHODS.has(method)) return 2;
  if (method === 'POST' && spec.idempotencyKey) return 2;
  return 0;
}

export function shouldRetry(
  response: Response,
  attempt: number,
  spec: HttpNodeSpec,
): boolean {
  if (attempt >= getMaxAttempts(spec)) return false;
  const retryableStatuses = spec.retryPolicy?.onStatuses ?? [429, 502, 503, 504];
  return retryableStatuses.includes(response.status);
}

export function computeRetryDelay(
  response: Response | null,
  attempt: number,
  spec: HttpNodeSpec,
): number {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }
    const date = new Date(retryAfter);
    if (!Number.isNaN(date.getTime())) {
      return Math.min(Math.max(0, date.getTime() - Date.now()), MAX_RETRY_AFTER_MS);
    }
  }

  const rp = spec.retryPolicy;
  if (rp) {
    const initialMs = (rp.initialDelay ?? 1) * 1000;
    const maxMs = (rp.maxDelay ?? 60) * 1000;
    let ms: number;
    switch (rp.backoff ?? 'exponential') {
      case 'fixed':
        ms = initialMs;
        break;
      case 'linear':
        ms = initialMs * (attempt + 1);
        break;
      case 'exponential':
      default:
        ms = initialMs * Math.pow(2, attempt);
        break;
    }
    return Math.min(ms, maxMs);
  }

  return 500 * Math.pow(2, attempt);
}

export function isRetryableNetworkError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return false;
    return true;
  }
  return false;
}
