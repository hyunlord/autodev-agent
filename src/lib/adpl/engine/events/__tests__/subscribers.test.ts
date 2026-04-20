import { describe, it, expect } from 'vitest';
import { EventBus } from '../bus';
import { MemoryEventCollector } from '../subscribers/memory-collector';
import { LoggingSubscriber } from '../subscribers/logger';
import type { RunStartedEvent } from '../types';

function makeRunStarted(runId = 'r1'): RunStartedEvent {
  return { type: 'run.started', timestamp: new Date(), runId, plan: {} as never };
}

describe('MemoryEventCollector', () => {
  it('captures all events via wildcard', () => {
    const bus = new EventBus();
    const collector = new MemoryEventCollector().attach(bus);
    bus.emit(makeRunStarted('r1'));
    bus.emit({ type: 'node.ready', timestamp: new Date(), runId: 'r1', nodeId: 'n1' });
    expect(collector.count()).toBe(2);
    expect(collector.all()[0].type).toBe('run.started');
  });

  it('ofType filters by type', () => {
    const bus = new EventBus();
    const collector = new MemoryEventCollector().attach(bus);
    bus.emit(makeRunStarted('r1'));
    bus.emit({ type: 'node.ready', timestamp: new Date(), runId: 'r1', nodeId: 'n1' });
    bus.emit({ type: 'node.ready', timestamp: new Date(), runId: 'r1', nodeId: 'n2' });
    expect(collector.ofType('node.ready')).toHaveLength(2);
    expect(collector.ofType('run.started')).toHaveLength(1);
  });

  it('forRun filters by runId', () => {
    const bus = new EventBus();
    const collector = new MemoryEventCollector().attach(bus);
    bus.emit(makeRunStarted('r1'));
    bus.emit(makeRunStarted('r2'));
    expect(collector.forRun('r1')).toHaveLength(1);
    expect(collector.forRun('r2')).toHaveLength(1);
  });

  it('detach stops collecting', () => {
    const bus = new EventBus();
    const collector = new MemoryEventCollector().attach(bus);
    bus.emit(makeRunStarted('r1'));
    collector.detach();
    bus.emit({ type: 'run.completed', timestamp: new Date(), runId: 'r1', status: 'success', durationMs: 100 });
    expect(collector.count()).toBe(1);
  });

  it('clear empties events', () => {
    const bus = new EventBus();
    const collector = new MemoryEventCollector().attach(bus);
    bus.emit(makeRunStarted('r1'));
    collector.clear();
    expect(collector.count()).toBe(0);
  });
});

describe('LoggingSubscriber', () => {
  it('logs all events by default', () => {
    const lines: string[] = [];
    const bus = new EventBus();
    new LoggingSubscriber({ log: (l) => lines.push(l) }).attach(bus);
    bus.emit(makeRunStarted('r1'));
    bus.emit({ type: 'node.ready', timestamp: new Date(), runId: 'r1', nodeId: 'n1' });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('run.started');
    expect(lines[0]).toContain('run=r1');
  });

  it('typePrefixes filters', () => {
    const lines: string[] = [];
    const bus = new EventBus();
    new LoggingSubscriber({ typePrefixes: ['run.'], log: (l) => lines.push(l) }).attach(bus);
    bus.emit(makeRunStarted('r1'));
    bus.emit({ type: 'node.ready', timestamp: new Date(), runId: 'r1', nodeId: 'n1' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('run.started');
  });

  it('verbose includes payload', () => {
    const lines: string[] = [];
    const bus = new EventBus();
    new LoggingSubscriber({ verbose: true, log: (l) => lines.push(l) }).attach(bus);
    bus.emit({
      type: 'node.completed',
      timestamp: new Date(),
      runId: 'r1',
      nodeId: 'n1',
      output: { status: 'success' as never, data: null },
      durationMs: 50,
    });
    expect(lines[0]).toContain('"nodeId":"n1"');
  });
});
