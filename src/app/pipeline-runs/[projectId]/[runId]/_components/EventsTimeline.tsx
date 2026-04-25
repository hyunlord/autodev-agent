import Link from 'next/link';
import type { PipelineEventRow } from '@/lib/db/queries/pipeline-runs';
import { computeEventsNav } from '../_lib/events-pagination';

export function EventsTimeline({
  events,
  projectId,
  runId,
  currentPage,
  pageSize,
}: {
  events: PipelineEventRow[];
  projectId: string;
  runId: string;
  currentPage: number;
  pageSize: number;
}) {
  const nav = computeEventsNav({
    projectId,
    runId,
    currentPage,
    pageSize,
    currentBatchLength: events.length,
  });

  return (
    <section
      className="rounded border p-4"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Events
        </h2>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          page {currentPage}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="text-sm py-4" style={{ color: 'var(--text-secondary)' }}>
          {currentPage === 1 ? 'No events recorded.' : 'No more events on this page.'}
        </p>
      ) : (
        <ul style={{ borderTop: '1px solid var(--border-color)' }}>
          {events.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </ul>
      )}

      <NavBar nav={nav} />
    </section>
  );
}

function EventRow({ event }: { event: PipelineEventRow }) {
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

function NavBar({
  nav,
}: {
  nav: ReturnType<typeof computeEventsNav>;
}) {
  if (!nav.hasPrev && !nav.hasNext) return null;

  const linkClass = 'px-3 py-1 text-xs rounded border hover:bg-[color:var(--bg-primary)]/40';
  const linkStyle = { borderColor: 'var(--border-color)', color: 'var(--text-primary)' };

  return (
    <div className="flex justify-center gap-2 mt-4">
      {nav.prevHref ? (
        <Link href={nav.prevHref} className={linkClass} style={linkStyle}>
          ← Prev
        </Link>
      ) : (
        <span className="px-3 py-1 text-xs rounded border opacity-30" style={linkStyle}>
          ← Prev
        </span>
      )}
      {nav.nextHref ? (
        <Link href={nav.nextHref} className={linkClass} style={linkStyle}>
          Next →
        </Link>
      ) : (
        <span className="px-3 py-1 text-xs rounded border opacity-30" style={linkStyle}>
          Next →
        </span>
      )}
    </div>
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
