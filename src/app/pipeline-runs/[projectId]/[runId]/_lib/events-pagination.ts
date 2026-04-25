/**
 * Stage 7 G2 — Events list pagination helpers.
 *
 * EventsTimeline shows up to `pageSize` events per page. We don't have a
 * server-side total (count() is intentionally avoided to keep the query
 * lightweight), so "has next" is approximated by "did the current page fill
 * the full pageSize". Edge case: if total events is exactly a multiple of
 * pageSize, the last page shows a Next link that yields an empty page —
 * acceptable trade-off for cheaper queries.
 */

export interface EventsNavLinks {
  hasPrev: boolean;
  hasNext: boolean;
  prevHref: string | null;
  nextHref: string | null;
}

export function computeEventsNav(args: {
  projectId: string;
  runId: string;
  currentPage: number;
  pageSize: number;
  currentBatchLength: number;
}): EventsNavLinks {
  const hasPrev = args.currentPage > 1;
  const hasNext = args.currentBatchLength === args.pageSize;
  const base = `/pipeline-runs/${args.projectId}/${args.runId}`;
  return {
    hasPrev,
    hasNext,
    prevHref: hasPrev ? buildHref(base, args.currentPage - 1) : null,
    nextHref: hasNext ? buildHref(base, args.currentPage + 1) : null,
  };
}

function buildHref(base: string, page: number): string {
  if (page <= 1) return base;
  return `${base}?eventsPage=${page}`;
}

/** Parses `?eventsPage=N` query value into a clamped 1-based page index. */
export function parseEventsPage(raw: string | undefined): number {
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}
