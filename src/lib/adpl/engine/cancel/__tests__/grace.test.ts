import { describe, it, expect, vi } from 'vitest';
import { CancellationToken } from '../token';
import { cancelWithGrace } from '../grace';

describe('cancelWithGrace', () => {
  it('all operations complete within grace: 0 timed out', async () => {
    const token = new CancellationToken();
    const ops = [
      new Promise((r) => setTimeout(r, 10)),
      new Promise((r) => setTimeout(r, 20)),
    ];
    const result = await cancelWithGrace(token, 'test', ops, { graceMs: 200 });
    expect(result.gracefulCount).toBe(2);
    expect(result.timedOutCount).toBe(0);
    expect(token.isCancelled).toBe(true);
  });

  it('operations exceed grace: timeout count > 0', async () => {
    const token = new CancellationToken();
    const ops = [
      new Promise((r) => setTimeout(r, 10)),
      new Promise((r) => setTimeout(r, 2000)),
    ];
    const result = await cancelWithGrace(token, 'test', ops, { graceMs: 80 });
    expect(result.gracefulCount).toBe(1);
    expect(result.timedOutCount).toBe(1);
  });

  it('onTimeout called when timed out', async () => {
    const token = new CancellationToken();
    const onTimeout = vi.fn();
    const ops = [new Promise((r) => setTimeout(r, 2000))];
    await cancelWithGrace(token, 'test', ops, { graceMs: 80, onTimeout });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('onTimeout NOT called when all graceful', async () => {
    const token = new CancellationToken();
    const onTimeout = vi.fn();
    const ops = [new Promise((r) => setTimeout(r, 10))];
    await cancelWithGrace(token, 'test', ops, { graceMs: 200, onTimeout });
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('rejected operations count as "done"', async () => {
    const token = new CancellationToken();
    const ops = [
      Promise.reject(new Error('test')),
      Promise.resolve('ok'),
    ];
    const result = await cancelWithGrace(token, 'test', ops, { graceMs: 200 });
    expect(result.gracefulCount).toBe(2);
    expect(result.timedOutCount).toBe(0);
  });

  it('token is cancelled before operations check', async () => {
    const token = new CancellationToken();
    let cancelledBeforeOp = false;
    const op = new Promise<void>((resolve) => {
      setTimeout(() => {
        cancelledBeforeOp = token.isCancelled;
        resolve();
      }, 10);
    });
    await cancelWithGrace(token, 'test', [op], { graceMs: 200 });
    expect(cancelledBeforeOp).toBe(true);
  });
});
