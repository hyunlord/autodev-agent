import { listPipelineEvents } from '@/lib/db/queries/pipeline-runs';
import {
  formatSseEvent,
  formatHeartbeat,
  computeNextCursor,
  type EventCursor,
} from './_lib/sse-format';

/**
 * Stage 7 G3 — Server-Sent Events stream for a pipeline run.
 *
 * Strategy: DB polling. Worker runs in a forked child process
 * (`WorkerManager.spawn → fork()`), so the Next.js handler cannot reach the
 * worker's in-process EventBus. We poll `pipeline_events` (already populated
 * by F5's DbEventSink) every `POLL_INTERVAL_MS` and stream each new row to
 * the client. Latency is therefore at most ~1 polling tick.
 *
 * Connection lifecycle:
 *   - Initial heartbeat written immediately (proxy keepalive).
 *   - Polling loop scheduled via `setInterval`; each tick fetches up to
 *     `BATCH_LIMIT` events newer than the last delivered `createdAt`.
 *   - On `req.signal.abort` (client disconnect / tab close), interval is
 *     cleared and the controller closed.
 */

export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 1000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const BATCH_LIMIT = 100;

export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const encoder = new TextEncoder();

  let cursor: EventCursor | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* controller closed by abort — handled below */
        }
      };

      // Immediate heartbeat so the client can confirm connection
      send(formatHeartbeat());

      const tick = () => {
        if (closed) return;
        try {
          const batch = listPipelineEvents(runId, {
            afterCursor: cursor ?? undefined,
            limit: BATCH_LIMIT,
          });
          for (const row of batch) {
            send(
              formatSseEvent({
                type: 'pipeline',
                id: row.id,
                data: {
                  id: row.id,
                  runId: row.runId,
                  type: row.type,
                  payloadJson: row.payloadJson,
                  createdAt: row.createdAt,
                },
              }),
            );
          }
          cursor = computeNextCursor(cursor, batch);
        } catch (err) {
          send(
            formatSseEvent({
              type: 'error',
              data: { message: err instanceof Error ? err.message : String(err) },
            }),
          );
        }
      };

      // First tick fires immediately so callers get any backlog right away.
      tick();
      pollTimer = setInterval(tick, POLL_INTERVAL_MS);
      heartbeatTimer = setInterval(() => send(formatHeartbeat()), HEARTBEAT_INTERVAL_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
