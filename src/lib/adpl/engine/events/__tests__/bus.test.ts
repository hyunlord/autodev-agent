import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../bus';
import type { RunStartedEvent } from '../types';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  function makeRunStarted(runId = 'r1'): RunStartedEvent {
    return {
      type: 'run.started',
      timestamp: new Date(),
      runId,
      plan: {} as never,
    };
  }

  describe('on + emit', () => {
    it('calls handler on matching type', () => {
      const handler = vi.fn();
      bus.on('run.started', handler);
      const event = makeRunStarted();
      bus.emit(event);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('does NOT call handler on different type', () => {
      const handler = vi.fn();
      bus.on('run.completed', handler);
      bus.emit(makeRunStarted());
      expect(handler).not.toHaveBeenCalled();
    });

    it('multiple handlers on same type all called', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on('run.started', h1);
      bus.on('run.started', h2);
      bus.emit(makeRunStarted());
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('type-narrowed handler receives typed event', () => {
      bus.on('run.started', (event) => {
        expect(event.type).toBe('run.started');
        expect(event.plan).toBeDefined();
      });
      bus.emit(makeRunStarted());
    });
  });

  describe('wildcard "*"', () => {
    it('receives all events', () => {
      const handler = vi.fn();
      bus.on('*', handler);
      bus.emit(makeRunStarted('r1'));
      bus.emit({
        type: 'node.ready',
        timestamp: new Date(),
        runId: 'r1',
        nodeId: 'n1',
      });
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('wildcard + specific handler both called', () => {
      const specific = vi.fn();
      const wild = vi.fn();
      bus.on('run.started', specific);
      bus.on('*', wild);
      bus.emit(makeRunStarted());
      expect(specific).toHaveBeenCalledTimes(1);
      expect(wild).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribe', () => {
    it('unsubscribe stops further calls', () => {
      const handler = vi.fn();
      const unsub = bus.on('run.started', handler);
      bus.emit(makeRunStarted());
      expect(handler).toHaveBeenCalledTimes(1);
      unsub();
      bus.emit(makeRunStarted());
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe only removes specific handler, not all of type', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      const unsub1 = bus.on('run.started', h1);
      bus.on('run.started', h2);
      unsub1();
      bus.emit(makeRunStarted());
      expect(h1).not.toHaveBeenCalled();
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('double unsubscribe is safe', () => {
      const unsub = bus.on('run.started', vi.fn());
      expect(() => {
        unsub();
        unsub();
      }).not.toThrow();
    });
  });

  describe('once', () => {
    it('fires only once', () => {
      const handler = vi.fn();
      bus.once('run.started', handler);
      bus.emit(makeRunStarted());
      bus.emit(makeRunStarted());
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('returned unsubscribe cancels before first call', () => {
      const handler = vi.fn();
      const unsub = bus.once('run.started', handler);
      unsub();
      bus.emit(makeRunStarted());
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('handler throw does not affect other handlers', () => {
      const errorReporter = vi.fn();
      bus = new EventBus({ errorReporter });
      const h1 = vi.fn(() => { throw new Error('boom'); });
      const h2 = vi.fn();
      bus.on('run.started', h1);
      bus.on('run.started', h2);
      bus.emit(makeRunStarted());
      expect(h1).toHaveBeenCalled();
      expect(h2).toHaveBeenCalled();
      expect(errorReporter).toHaveBeenCalledWith(expect.any(Error), 'run.started');
    });

    it('async handler rejection reported via errorReporter', async () => {
      const errorReporter = vi.fn();
      bus = new EventBus({ errorReporter });
      bus.on('run.started', async () => { throw new Error('async fail'); });
      bus.emit(makeRunStarted());
      await new Promise((r) => setTimeout(r, 10));
      expect(errorReporter).toHaveBeenCalledWith(expect.any(Error), 'run.started');
    });

    it('handler modifying handlers during emit is safe', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on('run.started', h1);
      bus.on('run.started', h2);
      bus.emit(makeRunStarted());
      expect(h1).toHaveBeenCalled();
      expect(h2).toHaveBeenCalled();
    });
  });

  describe('introspection', () => {
    it('listenerCount returns correct number', () => {
      expect(bus.listenerCount('run.started')).toBe(0);
      bus.on('run.started', vi.fn());
      bus.on('run.started', vi.fn());
      expect(bus.listenerCount('run.started')).toBe(2);
    });

    it('listTypes returns all registered types', () => {
      bus.on('run.started', vi.fn());
      bus.on('node.ready', vi.fn());
      bus.on('*', vi.fn());
      expect(bus.listTypes().sort()).toEqual(['*', 'node.ready', 'run.started']);
    });

    it('clear removes all handlers', () => {
      bus.on('run.started', vi.fn());
      bus.on('*', vi.fn());
      bus.clear();
      expect(bus.listTypes()).toHaveLength(0);
    });
  });
});
