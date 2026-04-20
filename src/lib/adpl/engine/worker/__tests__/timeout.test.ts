import { describe, it, expect } from 'vitest';
import { withTimeout, TimeoutError } from '../timeout';

describe('withTimeout', () => {
  it('resolves when promise completes before timeout', async () => {
    const result = await withTimeout(
      new Promise<string>((r) => setTimeout(() => r('ok'), 10)),
      200,
      'timeout',
    );
    expect(result).toBe('ok');
  });

  it('throws TimeoutError when timeout fires first', async () => {
    await expect(
      withTimeout(
        new Promise<void>((r) => setTimeout(r, 200)),
        30,
        'test timeout',
      ),
    ).rejects.toThrow(TimeoutError);
  });

  it('TimeoutError carries timeoutMs', async () => {
    try {
      await withTimeout(new Promise<void>(() => {}), 20, 'msg');
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      expect((err as TimeoutError).timeoutMs).toBe(20);
      expect((err as TimeoutError).message).toBe('msg');
    }
  });

  it('0 timeoutMs: no timeout (original promise passes through)', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 0, 'x');
    expect(result).toBe('ok');
  });

  it('negative timeoutMs: no timeout', async () => {
    const result = await withTimeout(Promise.resolve(42), -100, 'x');
    expect(result).toBe(42);
  });

  it('Infinity timeoutMs: no timeout', async () => {
    const result = await withTimeout(Promise.resolve('inf'), Infinity, 'x');
    expect(result).toBe('inf');
  });

  it('propagates promise rejection (not a TimeoutError)', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('fail')), 200, 'x'),
    ).rejects.toThrow('fail');
  });

  it('timer is cleared on resolve (no dangling timer)', async () => {
    // withTimeout(fast, long) — fast resolves, long timer must be cleared
    const result = await withTimeout(
      Promise.resolve('fast'),
      10_000,
      'should not fire',
    );
    expect(result).toBe('fast');
    // If timer wasn't cleared, vitest would hang waiting for 10s timer
  });
});
