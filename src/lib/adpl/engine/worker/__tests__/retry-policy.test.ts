import { describe, it, expect } from 'vitest';
import { shouldRetry, calcBackoff, sleepWithCancel } from '../retry-policy';
import { CancellationToken } from '../../cancel/token';
import type { RetryPolicy } from '@/lib/adpl/types';

// ─── shouldRetry ─────────────────────────────────────────────────────────────

describe('shouldRetry', () => {
  const transientErr = { code: 'network', message: 'x', category: 'transient' as const };
  const timeoutErr   = { code: 'timeout',  message: 'x', category: 'timeout'   as const };
  const persistentErr = { code: 'x', message: 'x', category: 'persistent' as const };
  const cancelErr    = { code: 'cancelled', message: 'x', category: 'cancellation' as const };

  function makeNode(retryPolicy?: RetryPolicy) {
    return { spec: { type: 'shell', id: 'n', retryPolicy } } as any;
  }

  it('no retryPolicy → false', () => {
    expect(shouldRetry(makeNode(), transientErr, 1)).toBe(false);
  });

  it('maxAttempts=1 → false (no retries)', () => {
    expect(shouldRetry(makeNode({ maxAttempts: 1 }), transientErr, 1)).toBe(false);
  });

  it('maxAttempts=3, attempt=1 → true', () => {
    expect(shouldRetry(makeNode({ maxAttempts: 3 }), transientErr, 1)).toBe(true);
  });

  it('maxAttempts=3, attempt=2 → true', () => {
    expect(shouldRetry(makeNode({ maxAttempts: 3 }), transientErr, 2)).toBe(true);
  });

  it('maxAttempts=3, attempt=3 → false (exhausted)', () => {
    expect(shouldRetry(makeNode({ maxAttempts: 3 }), transientErr, 3)).toBe(false);
  });

  it('timeout category → retried', () => {
    expect(shouldRetry(makeNode({ maxAttempts: 3 }), timeoutErr, 1)).toBe(true);
  });

  it('persistent category → not retried', () => {
    expect(shouldRetry(makeNode({ maxAttempts: 5 }), persistentErr, 1)).toBe(false);
  });

  it('cancellation category → never retried', () => {
    expect(shouldRetry(makeNode({ maxAttempts: 10 }), cancelErr, 1)).toBe(false);
  });

  it('no error → false', () => {
    expect(shouldRetry(makeNode({ maxAttempts: 3 }), undefined, 1)).toBe(false);
  });
});

// ─── calcBackoff ──────────────────────────────────────────────────────────────

describe('calcBackoff', () => {
  it('fixed: always initialDelay * 1000', () => {
    const config: RetryPolicy = { maxAttempts: 5, backoff: 'fixed', initialDelay: 2 };
    expect(calcBackoff(config, 1)).toBe(2000);
    expect(calcBackoff(config, 5)).toBe(2000);
  });

  it('linear: initialDelay * retryNum (ms)', () => {
    const config: RetryPolicy = { maxAttempts: 5, backoff: 'linear', initialDelay: 1 };
    expect(calcBackoff(config, 1)).toBe(1000);
    expect(calcBackoff(config, 3)).toBe(3000);
    expect(calcBackoff(config, 5)).toBe(5000);
  });

  it('exponential: initialDelay * 2^(retryNum-1)', () => {
    const config: RetryPolicy = { maxAttempts: 6, backoff: 'exponential', initialDelay: 1 };
    expect(calcBackoff(config, 1)).toBe(1000);
    expect(calcBackoff(config, 2)).toBe(2000);
    expect(calcBackoff(config, 3)).toBe(4000);
    expect(calcBackoff(config, 4)).toBe(8000);
  });

  it('capped at maxDelay (seconds → ms)', () => {
    const config: RetryPolicy = { maxAttempts: 10, backoff: 'exponential', initialDelay: 1, maxDelay: 5 };
    // retryNum=10 → 512s but capped at 5s = 5000ms
    expect(calcBackoff(config, 10)).toBe(5000);
  });

  it('defaults: exponential, initialDelay=1s, maxDelay=60s', () => {
    const config: RetryPolicy = { maxAttempts: 3 };
    expect(calcBackoff(config, 1)).toBe(1000);
    expect(calcBackoff(config, 2)).toBe(2000);
  });

  it('very large retryNum capped at default maxDelay=60s', () => {
    const config: RetryPolicy = { maxAttempts: 100 };
    expect(calcBackoff(config, 100)).toBe(60_000);
  });
});

// ─── sleepWithCancel ──────────────────────────────────────────────────────────

describe('sleepWithCancel', () => {
  it('resolves after specified delay', async () => {
    const token = new CancellationToken();
    const start = Date.now();
    await sleepWithCancel(30, token);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });

  it('0 ms: resolves immediately', async () => {
    const token = new CancellationToken();
    const start = Date.now();
    await sleepWithCancel(0, token);
    expect(Date.now() - start).toBeLessThan(20);
  });

  it('cancels early when token is cancelled during sleep', async () => {
    const token = new CancellationToken();
    setTimeout(() => token.cancel('test'), 20);
    const start = Date.now();
    await sleepWithCancel(2000, token);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('already-cancelled token: resolves immediately', async () => {
    const token = new CancellationToken();
    token.cancel('pre-cancel');
    const start = Date.now();
    await sleepWithCancel(2000, token);
    expect(Date.now() - start).toBeLessThan(50);
  });
});
