'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Stage 7 G3 — Live tail of `pipeline_events` for a running run.
 *
 * Connection model: SSE typed events ('pipeline' | 'error') sourced from
 * /api/pipeline-runs/[runId]/events/stream. The endpoint polls `pipeline_events`
 * server-side; this component only consumes the stream.
 *
 * Memory: keeps the latest `MAX_EVENTS` (200) in a ring buffer to bound
 * long-running tabs.
 */

const MAX_EVENTS = 200;

interface LiveEvent {
  id: string;
  runId: string;
  type: string;
  payloadJson: string;
  createdAt: string;
}

type ConnState = 'connecting' | 'open' | 'closed' | 'error';

export function LiveEventsFeed({ runId }: { runId: string }) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [conn, setConn] = useState<ConnState>('connecting');
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/pipeline-runs/${runId}/events/stream`);
    esRef.current = es;
    setConn('connecting');

    const onOpen = () => setConn('open');
    const onError = () => setConn('error');
    const onPipeline = (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as LiveEvent;
        setEvents((prev) => {
          const next = [...prev, parsed];
          return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
        });
      } catch {
        /* malformed payload — ignore */
      }
    };

    es.addEventListener('open', onOpen);
    es.addEventListener('error', onError);
    es.addEventListener('pipeline', onPipeline);

    return () => {
      es.removeEventListener('open', onOpen);
      es.removeEventListener('error', onError);
      es.removeEventListener('pipeline', onPipeline);
      es.close();
      setConn('closed');
    };
  }, [runId]);

  return (
    <section
      className="rounded border p-4"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Live Events
        </h2>
        <ConnIndicator state={conn} count={events.length} />
      </header>

      {events.length === 0 ? (
        <p className="text-sm py-4" style={{ color: 'var(--text-secondary)' }}>
          {conn === 'open' ? 'Waiting for events...' : 'Connecting...'}
        </p>
      ) : (
        <ul style={{ borderTop: '1px solid var(--border-color)' }}>
          {events.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ConnIndicator({ state, count }: { state: ConnState; count: number }) {
  const colorMap: Record<ConnState, { dot: string; label: string }> = {
    connecting: { dot: 'bg-amber-500', label: 'connecting' },
    open: { dot: 'bg-emerald-500', label: 'live' },
    closed: { dot: 'bg-gray-500', label: 'closed' },
    error: { dot: 'bg-red-500', label: 'error' },
  };
  const { dot, label } = colorMap[state];
  return (
    <span className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
      <span className={`w-2 h-2 rounded-full ${dot} ${state === 'open' ? 'animate-pulse' : ''}`} aria-hidden="true" />
      <span>{label}</span>
      <span className="font-mono">· {count}</span>
    </span>
  );
}

function EventRow({ event }: { event: LiveEvent }) {
  const summary = summarizePayload(event.payloadJson);
  return (
    <li
      className="grid grid-cols-12 gap-2 py-2 text-xs"
      style={{ borderBottom: '1px solid var(--border-color)' }}
    >
      <span className="col-span-3 font-mono" style={{ color: 'var(--text-secondary)' }}>
        {formatTimestamp(event.createdAt)}
      </span>
      <span className="col-span-3 font-mono" style={{ color: 'var(--text-primary)' }}>
        {event.type}
      </span>
      <span
        className="col-span-6 truncate"
        title={event.payloadJson}
        style={{ color: 'var(--text-secondary)' }}
      >
        {summary}
      </span>
    </li>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function summarizePayload(json: string): string {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const interesting: string[] = [];
    for (const key of ['nodeId', 'attempt', 'durationMs', 'reason', 'parallelId', 'parentId']) {
      const v = parsed[key];
      if (v !== undefined) interesting.push(`${key}=${JSON.stringify(v)}`);
    }
    return interesting.length > 0 ? interesting.join(' · ') : '(no extra fields)';
  } catch {
    return json.slice(0, 200);
  }
}
