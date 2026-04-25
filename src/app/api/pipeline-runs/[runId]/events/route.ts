import { NextResponse } from 'next/server';
import { listPipelineEvents } from '@/lib/db/queries/pipeline-runs';

/**
 * Stage 7 G0 — pipeline events for a run.
 *
 *   GET /api/pipeline-runs/[runId]/events
 *     ?type=node.completed   (exact-match filter)
 *     &since=2026-04-25T...  (ISO timestamp, exclusive lower bound)
 *     &limit=100             (default 100, hard cap 1000)
 *     &offset=0
 */
export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const url = new URL(req.url);

  const type = url.searchParams.get('type') ?? undefined;
  const since = url.searchParams.get('since') ?? undefined;
  const limit = parseIntSafe(url.searchParams.get('limit'));
  const offset = parseIntSafe(url.searchParams.get('offset'));

  const rows = listPipelineEvents(runId, {
    type: type || undefined,
    since: since || undefined,
    limit,
    offset,
  });
  return NextResponse.json({ data: rows });
}

function parseIntSafe(raw: string | null): number | undefined {
  if (raw == null) return undefined;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? undefined : n;
}
