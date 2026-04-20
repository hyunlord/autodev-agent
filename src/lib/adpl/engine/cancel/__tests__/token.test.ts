import { describe, it, expect, vi } from 'vitest';
import { CancellationToken, CancellationError } from '../token';

describe('CancellationToken', () => {
  describe('cancel', () => {
    it('initial state: not cancelled', () => {
      const token = new CancellationToken();
      expect(token.isCancelled).toBe(false);
      expect(token.reason).toBe('');
    });

    it('cancel sets isCancelled and reason', () => {
      const token = new CancellationToken();
      token.cancel('user request');
      expect(token.isCancelled).toBe(true);
      expect(token.reason).toBe('user request');
    });

    it('cancel is idempotent', () => {
      const token = new CancellationToken();
      const listener = vi.fn();
      token.onCancel(listener);

      token.cancel('first');
      token.cancel('second');
      token.cancel('third');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(token.reason).toBe('first');
    });
  });

  describe('onCancel', () => {
    it('listener called on cancel', () => {
      const token = new CancellationToken();
      const listener = vi.fn();
      token.onCancel(listener);
      token.cancel('test');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('multiple listeners all called', () => {
      const token = new CancellationToken();
      const l1 = vi.fn();
      const l2 = vi.fn();
      token.onCancel(l1);
      token.onCancel(l2);
      token.cancel('test');
      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe removes listener', () => {
      const token = new CancellationToken();
      const listener = vi.fn();
      const unsub = token.onCancel(listener);
      unsub();
      token.cancel('test');
      expect(listener).not.toHaveBeenCalled();
    });

    it('already cancelled: listener called immediately', () => {
      const token = new CancellationToken();
      token.cancel('pre-cancelled');
      const listener = vi.fn();
      token.onCancel(listener);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('listener throw does not affect other listeners', () => {
      const token = new CancellationToken();
      const l1 = vi.fn(() => { throw new Error('boom'); });
      const l2 = vi.fn();
      token.onCancel(l1);
      token.onCancel(l2);
      expect(() => token.cancel('test')).not.toThrow();
      expect(l1).toHaveBeenCalled();
      expect(l2).toHaveBeenCalled();
    });
  });

  describe('throwIfCancelled', () => {
    it('no throw when not cancelled', () => {
      const token = new CancellationToken();
      expect(() => token.throwIfCancelled()).not.toThrow();
    });

    it('throws CancellationError when cancelled', () => {
      const token = new CancellationToken();
      token.cancel('test reason');
      expect(() => token.throwIfCancelled()).toThrow(CancellationError);
    });

    it('error contains reason', () => {
      const token = new CancellationToken();
      token.cancel('user stop');
      try {
        token.throwIfCancelled();
      } catch (err) {
        expect(err).toBeInstanceOf(CancellationError);
        expect((err as CancellationError).reason).toBe('user stop');
      }
    });
  });

  describe('signal (AbortController integration)', () => {
    it('signal exists (lazy init)', () => {
      const token = new CancellationToken();
      expect(token.signal).toBeInstanceOf(AbortSignal);
    });

    it('signal aborts on cancel', () => {
      const token = new CancellationToken();
      const signal = token.signal;
      expect(signal.aborted).toBe(false);
      token.cancel('test');
      expect(signal.aborted).toBe(true);
    });

    it('signal works with abort event listener', () => {
      const token = new CancellationToken();
      const signal = token.signal;
      const abortListener = vi.fn();
      signal.addEventListener('abort', abortListener);
      token.cancel('test');
      expect(abortListener).toHaveBeenCalledTimes(1);
    });

    it('already cancelled: signal immediately aborted', () => {
      const token = new CancellationToken();
      token.cancel('pre-cancelled');
      expect(token.signal.aborted).toBe(true);
    });
  });

  describe('listenerCount', () => {
    it('tracks listener count', () => {
      const token = new CancellationToken();
      expect(token.listenerCount()).toBe(0);
      const unsub1 = token.onCancel(() => {});
      expect(token.listenerCount()).toBe(1);
      token.onCancel(() => {});
      expect(token.listenerCount()).toBe(2);
      unsub1();
      expect(token.listenerCount()).toBe(1);
    });
  });
});
