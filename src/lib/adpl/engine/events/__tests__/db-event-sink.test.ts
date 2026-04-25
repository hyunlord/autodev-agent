import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { pipelineEvents } from '@/lib/db/schema';
import { EventBus } from '../bus';
import { DbEventSink } from '../subscribers/db-event-sink';
import type { NodeReadyEvent, NodeStartedEvent, NodeCompletedEvent } from '../types';

function nodeReady(runId: string, nodeId: string): NodeReadyEvent {
  return { type: 'node.ready', timestamp: new Date(), runId, nodeId };
}

function nodeStarted(runId: string, nodeId: string, attempt: number): NodeStartedEvent {
  return { type: 'node.started', timestamp: new Date(), runId, nodeId, attempt };
}

function nodeCompleted(runId: string, nodeId: string): NodeCompletedEvent {
  return {
    type: 'node.completed',
    timestamp: new Date(),
    runId,
    nodeId,
    output: { status: 'success', data: null },
    durationMs: 1,
  };
}

describe('DbEventSink — Stage 6 F5', () => {
  beforeEach(() => {
    db.delete(pipelineEvents).run();
  });

  it('1. attach + emit → row inserted into pipeline_events', async () => {
    const bus = new EventBus();
    const sink = new DbEventSink('run-1');
    sink.attach(bus);

    bus.emit(nodeReady('run-1', 'pipeline.0'));

    // persist is async (Promise.resolve flushes microtasks)
    await Promise.resolve();

    const rows = db.select().from(pipelineEvents).where(eq(pipelineEvents.runId, 'run-1')).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('node.ready');
    const payload = JSON.parse(rows[0].payloadJson);
    expect(payload.nodeId).toBe('pipeline.0');

    sink.detach();
  });

  it('2. multi-emit (5 events) → 5 rows persisted in order', async () => {
    const bus = new EventBus();
    const sink = new DbEventSink('run-multi');
    sink.attach(bus);

    bus.emit(nodeReady('run-multi', 'a'));
    bus.emit(nodeStarted('run-multi', 'a', 1));
    bus.emit(nodeCompleted('run-multi', 'a'));
    bus.emit(nodeReady('run-multi', 'b'));
    bus.emit(nodeStarted('run-multi', 'b', 1));

    await Promise.resolve();

    const rows = db
      .select()
      .from(pipelineEvents)
      .where(eq(pipelineEvents.runId, 'run-multi'))
      .all();
    expect(rows).toHaveLength(5);
    // Insertion order is preserved by SQLite rowid; check createdAt ordering matches emit order
    const types = rows.map((r) => r.type);
    expect(types).toEqual(['node.ready', 'node.started', 'node.completed', 'node.ready', 'node.started']);

    sink.detach();
  });

  it('3. event.runId on EventBase wins over fallback runId', async () => {
    const bus = new EventBus();
    const sink = new DbEventSink('FALLBACK');
    sink.attach(bus);

    bus.emit(nodeReady('event-run-id', 'n1'));
    await Promise.resolve();

    const rows = db.select().from(pipelineEvents).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].runId).toBe('event-run-id');

    sink.detach();
  });

  it('4. fallback runId used when event.runId is missing/empty', async () => {
    const bus = new EventBus();
    const sink = new DbEventSink('FALLBACK-ID');
    sink.attach(bus);

    // Cast through unknown to bypass strict typing — simulate event without runId
    const eventWithoutRunId = {
      type: 'node.ready' as const,
      timestamp: new Date(),
      nodeId: 'orphan',
      // runId omitted (event-base says runId is required, but defensive code path matters)
    } as unknown as NodeReadyEvent;
    bus.emit(eventWithoutRunId);
    await Promise.resolve();

    const rows = db.select().from(pipelineEvents).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].runId).toBe('FALLBACK-ID');

    sink.detach();
  });

  it('5. detach() stops further inserts', async () => {
    const bus = new EventBus();
    const sink = new DbEventSink('run-detach');
    sink.attach(bus);

    bus.emit(nodeReady('run-detach', 'a'));
    await Promise.resolve();

    sink.detach();
    bus.emit(nodeReady('run-detach', 'b'));
    await Promise.resolve();

    const rows = db.select().from(pipelineEvents).where(eq(pipelineEvents.runId, 'run-detach')).all();
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0].payloadJson);
    expect(payload.nodeId).toBe('a');
  });

  it('6. DB write failure is isolated → emit does not throw, errorReporter called, failureCount tracked', async () => {
    const bus = new EventBus();
    const reported: unknown[] = [];
    const sink = new DbEventSink('run-fail', (e) => reported.push(e));

    // Force every persist() to reject by monkey-patching the private method.
    const sinkAny = sink as unknown as { persist: (e: unknown) => Promise<void> };
    sinkAny.persist = () => Promise.reject(new Error('simulated DB failure'));

    sink.attach(bus);

    expect(() => bus.emit(nodeReady('run-fail', 'a'))).not.toThrow();
    await Promise.resolve();

    expect(sink.failureCount).toBe(1);
    expect(reported).toHaveLength(1);

    // 9 more failures → only 1st of next decade (i.e. failure #11) reports again
    for (let i = 0; i < 9; i++) {
      bus.emit(nodeReady('run-fail', `n${i}`));
    }
    await Promise.resolve();

    expect(sink.failureCount).toBe(10);
    expect(reported).toHaveLength(1); // still 1, no spam

    bus.emit(nodeReady('run-fail', 'n11'));
    await Promise.resolve();
    expect(sink.failureCount).toBe(11);
    expect(reported).toHaveLength(2); // 11th triggers next report

    sink.detach();
  });

  it('7. double attach → throws "already attached"', () => {
    const bus = new EventBus();
    const sink = new DbEventSink('run-dup');
    sink.attach(bus);

    expect(() => sink.attach(bus)).toThrow(/already attached/);

    sink.detach();
  });

  it('8. detach is idempotent (no throw when never attached)', () => {
    const sink = new DbEventSink('run-noop');
    expect(() => sink.detach()).not.toThrow();
  });
});
