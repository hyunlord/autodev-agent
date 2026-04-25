import { nanoid } from 'nanoid';
import { db } from '@/lib/db/client';
import { pipelineEvents } from '@/lib/db/schema';
import type { EventBus } from '../bus';
import type { EngineEvent } from '../types';

/**
 * Stage 6 F5 — Observability sink.
 *
 * Subscribes to all engine events via `bus.on('*', ...)` (same pattern as
 * MemoryEventCollector) and persists each one as a row in `pipeline_events`.
 *
 * Failure mode: every DB write failure is forwarded to `errorReporter` and
 * counted; pipeline execution is never affected because the subscriber sits
 * downstream of `EventBus.emit` (which already isolates handler exceptions).
 *
 * Spam guard: only the 1st, 11th, 21st, ... failure is reported through
 * `errorReporter`. The full counter is exposed via `failureCount` for tests
 * and diagnostics.
 *
 * Lifecycle: caller is responsible for `detach()` (use try/finally) so the
 * EventBus does not retain a reference after the run completes.
 */
export class DbEventSink {
  private unsubscribe?: () => void;
  private writeFailures = 0;

  constructor(
    private readonly fallbackRunId: string,
    private readonly errorReporter: (err: unknown) => void = (e) =>
      console.error('[DbEventSink]', e),
  ) {}

  attach(bus: EventBus): void {
    if (this.unsubscribe) {
      throw new Error('DbEventSink: already attached');
    }
    this.unsubscribe = bus.on('*', (event) => {
      // EventBus.emit calls handlers synchronously; promises are unwrapped
      // and routed through EventBus.errorReporter on rejection. We add our
      // own catch as belt-and-suspenders so failureCount stays correct
      // even when EventBus is configured with a no-op errorReporter.
      this.persist(event).catch((err) => this.handleFailure(err));
    });
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  get failureCount(): number {
    return this.writeFailures;
  }

  private async persist(event: EngineEvent): Promise<void> {
    const eventRunId = (event as { runId?: string }).runId;
    db.insert(pipelineEvents)
      .values({
        id: nanoid(),
        runId: eventRunId ?? this.fallbackRunId,
        type: event.type,
        payloadJson: JSON.stringify(event),
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  private handleFailure(err: unknown): void {
    this.writeFailures++;
    if (this.writeFailures % 10 === 1) {
      const latest = err instanceof Error ? err.message : String(err);
      this.errorReporter(
        new Error(
          `DbEventSink: ${this.writeFailures} write failure(s) so far. Latest: ${latest}`,
        ),
      );
    }
  }
}
