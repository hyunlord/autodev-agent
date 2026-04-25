import { NextResponse } from 'next/server';
import { getPipelineRun } from '@/lib/db/queries/pipeline-runs';

/**
 * Stage 7 G0 — single pipeline run.
 *   GET /api/pipeline-runs/[runId]
 */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = getPipelineRun(runId);
  if (!run) {
    return NextResponse.json({ error: 'PIPELINE_RUN_NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ data: run });
}
