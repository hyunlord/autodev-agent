import { describe, it, expect } from 'vitest';
import { getMaxAttempts, shouldRetry, computeRetryDelay, MAX_RETRY_AFTER_MS } from '../retry';
import type { HttpNodeSpec } from '@/lib/adpl/types/nodes/http';

function spec(overrides: Partial<HttpNodeSpec> = {}): HttpNodeSpec {
  return { id: 'test', type: 'http', url: 'https://example.com', ...overrides };
}

function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe('getMaxAttempts — idempotent methods default to 2', () => {
  it.each(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'] as const)(
    '%s → 2 attempts',
    (method) => {
      expect(getMaxAttempts(spec({ method }))).toBe(2);
    },
  );
});

describe('getMaxAttempts — non-idempotent methods', () => {
  it('POST without idempotencyKey → 0 retries', () => {
    expect(getMaxAttempts(spec({ method: 'POST' }))).toBe(0);
  });

  it('PATCH without idempotencyKey → 0 retries', () => {
    expect(getMaxAttempts(spec({ method: 'PATCH' }))).toBe(0);
  });

  it('POST with idempotencyKey → 2 retries', () => {
    expect(getMaxAttempts(spec({ method: 'POST', idempotencyKey: 'idem-key-123' }))).toBe(2);
  });
});

describe('getMaxAttempts — explicit retryPolicy overrides defaults', () => {
  it('explicit maxAttempts 5 on GET', () => {
    expect(getMaxAttempts(spec({ method: 'GET', retryPolicy: { maxAttempts: 5 } }))).toBe(5);
  });

  it('explicit maxAttempts 0 disables retries on GET', () => {
    expect(getMaxAttempts(spec({ method: 'GET', retryPolicy: { maxAttempts: 0 } }))).toBe(0);
  });
});

describe('shouldRetry', () => {
  it('returns true for 429 on GET (attempt 0, maxAttempts 2)', () => {
    expect(shouldRetry(mockResponse(429), 0, spec({ method: 'GET' }))).toBe(true);
  });

  it('returns true for 503 on GET', () => {
    expect(shouldRetry(mockResponse(503), 0, spec({ method: 'GET' }))).toBe(true);
  });

  it('returns true for 502, 504 on GET', () => {
    expect(shouldRetry(mockResponse(502), 0, spec({ method: 'GET' }))).toBe(true);
    expect(shouldRetry(mockResponse(504), 0, spec({ method: 'GET' }))).toBe(true);
  });

  it('returns false for 200', () => {
    expect(shouldRetry(mockResponse(200), 0, spec({ method: 'GET' }))).toBe(false);
  });

  it('returns false for 500 (not in default retryable statuses)', () => {
    expect(shouldRetry(mockResponse(500), 0, spec({ method: 'GET' }))).toBe(false);
  });

  it('returns false when attempt >= maxAttempts', () => {
    expect(shouldRetry(mockResponse(429), 2, spec({ method: 'GET' }))).toBe(false);
    expect(shouldRetry(mockResponse(429), 3, spec({ method: 'GET' }))).toBe(false);
  });

  it('returns false for POST without idempotencyKey (maxAttempts 0)', () => {
    expect(shouldRetry(mockResponse(429), 0, spec({ method: 'POST' }))).toBe(false);
  });

  it('respects custom onStatuses from retryPolicy', () => {
    const s = spec({ method: 'GET', retryPolicy: { maxAttempts: 3, onStatuses: [500, 503] } });
    expect(shouldRetry(mockResponse(500), 0, s)).toBe(true);
    expect(shouldRetry(mockResponse(429), 0, s)).toBe(false);
  });
});

describe('computeRetryDelay — Retry-After header', () => {
  it('parses integer seconds', () => {
    const res = mockResponse(429, { 'retry-after': '2' });
    expect(computeRetryDelay(res, 0, spec())).toBe(2000);
  });

  it('parses 0 seconds', () => {
    const res = mockResponse(429, { 'retry-after': '0' });
    expect(computeRetryDelay(res, 0, spec())).toBe(0);
  });

  it('caps large Retry-After at MAX_RETRY_AFTER_MS', () => {
    const res = mockResponse(429, { 'retry-after': '3600' });
    expect(computeRetryDelay(res, 0, spec())).toBe(MAX_RETRY_AFTER_MS);
  });

  it('parses HTTP-date format', () => {
    const futureDate = new Date(Date.now() + 5000);
    const res = mockResponse(429, { 'retry-after': futureDate.toUTCString() });
    const delay = computeRetryDelay(res, 0, spec());
    // Allow ±500ms tolerance for execution time
    expect(delay).toBeGreaterThan(4000);
    expect(delay).toBeLessThanOrEqual(MAX_RETRY_AFTER_MS);
  });

  it('caps HTTP-date delay at MAX_RETRY_AFTER_MS', () => {
    const farFuture = new Date(Date.now() + 120_000);
    const res = mockResponse(429, { 'retry-after': farFuture.toUTCString() });
    expect(computeRetryDelay(res, 0, spec())).toBe(MAX_RETRY_AFTER_MS);
  });

  it('past HTTP-date returns 0', () => {
    const past = new Date(Date.now() - 5000);
    const res = mockResponse(429, { 'retry-after': past.toUTCString() });
    expect(computeRetryDelay(res, 0, spec())).toBe(0);
  });
});

describe('computeRetryDelay — backoff from retryPolicy', () => {
  it('exponential backoff (default) with initialDelay 1s', () => {
    const s = spec({ retryPolicy: { maxAttempts: 3, initialDelay: 1 } });
    expect(computeRetryDelay(null, 0, s)).toBe(1000); // 1s * 2^0
    expect(computeRetryDelay(null, 1, s)).toBe(2000); // 1s * 2^1
    expect(computeRetryDelay(null, 2, s)).toBe(4000); // 1s * 2^2
  });

  it('fixed backoff', () => {
    const s = spec({ retryPolicy: { maxAttempts: 3, initialDelay: 2, backoff: 'fixed' } });
    expect(computeRetryDelay(null, 0, s)).toBe(2000);
    expect(computeRetryDelay(null, 1, s)).toBe(2000);
  });

  it('linear backoff', () => {
    const s = spec({ retryPolicy: { maxAttempts: 3, initialDelay: 1, backoff: 'linear' } });
    expect(computeRetryDelay(null, 0, s)).toBe(1000); // 1s * 1
    expect(computeRetryDelay(null, 1, s)).toBe(2000); // 1s * 2
  });

  it('respects maxDelay cap', () => {
    const s = spec({
      retryPolicy: { maxAttempts: 5, initialDelay: 10, backoff: 'exponential', maxDelay: 15 },
    });
    // 10s * 2^2 = 40s, but capped at 15s
    expect(computeRetryDelay(null, 2, s)).toBe(15_000);
  });
});

describe('computeRetryDelay — default exponential fallback (no retryPolicy)', () => {
  it('uses 500ms base', () => {
    expect(computeRetryDelay(null, 0, spec())).toBe(500);
    expect(computeRetryDelay(null, 1, spec())).toBe(1000);
    expect(computeRetryDelay(null, 2, spec())).toBe(2000);
  });
});
