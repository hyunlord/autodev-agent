/**
 * Stage 7 G3 — Pure helpers for the SSE event-stream endpoint.
 *
 * Worker runs in a forked child process (`WorkerManager.spawn → fork()`),
 * so the Next.js request handler cannot subscribe to the in-process
 * EventBus directly. We poll `pipeline_events` instead, sliced by the
 * `createdAt` timestamp of the last row delivered to this client.
 */

export interface SseEvent {
  /** Optional explicit `event:` line — clients that addEventListener('pipeline') key on this. */
  type?: string;
  /** Stable per-row identifier so reconnects can resume (Stage 7+). */
  id?: string;
  /** Plain JSON-serializable payload. */
  data: unknown;
}

/** Returns a single SSE wire frame ending in the required `\n\n` separator. */
export function formatSseEvent(event: SseEvent): string {
  const lines: string[] = [];
  if (event.type) lines.push(`event: ${event.type}`);
  if (event.id) lines.push(`id: ${event.id}`);
  lines.push(`data: ${JSON.stringify(event.data)}`);
  return lines.join('\n') + '\n\n';
}

/** Heartbeat comment frame to keep proxies / browsers from closing the stream. */
export function formatHeartbeat(): string {
  return `: heartbeat\n\n`;
}

/**
 * Given an ordered batch of events (asc by createdAt) and the previous "since"
 * cursor, returns the next cursor — newest createdAt seen, or the previous one
 * when the batch is empty.
 *
 * @deprecated Stage 7 G3 micro-fix introduced `computeNextCursor` that uses
 * a composite (createdAt, id) cursor to survive same-millisecond ties. Kept
 * for callers that only need coarse pagination.
 */
export function computeNextSince(
  prev: string | undefined,
  batch: ReadonlyArray<{ createdAt: string }>,
): string | undefined {
  if (batch.length === 0) return prev;
  // batch is asc by createdAt (G0 query layer guarantees this) — last element wins.
  const last = batch[batch.length - 1].createdAt;
  return last;
}

/** Composite cursor used by the SSE stream's polling loop (G3 micro-fix). */
export interface EventCursor {
  createdAt: string;
  id: string;
}

/**
 * Given an asc-ordered batch of `(createdAt, id)`, returns the cursor of the
 * last row, or `prev` when the batch is empty. The query layer matches with
 * `(row.createdAt, row.id) > (cursor.createdAt, cursor.id)` so same-millisecond
 * ties are not lost across polling ticks.
 */
export function computeNextCursor(
  prev: EventCursor | null,
  batch: ReadonlyArray<{ createdAt: string; id: string }>,
): EventCursor | null {
  if (batch.length === 0) return prev;
  const last = batch[batch.length - 1];
  return { createdAt: last.createdAt, id: last.id };
}
