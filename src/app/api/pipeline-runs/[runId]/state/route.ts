import { NextResponse } from 'next/server';
import { getPipelineRunState } from '@/lib/db/queries/pipeline-runs';

/**
 * Stage 7 G0 — restored PipelineRunState (parsed from stateJson).
 *   GET /api/pipeline-runs/[runId]/state
 */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const view = getPipelineRunState(runId);
  if (!view) {
    return NextResponse.json({ error: 'PIPELINE_RUN_STATE_NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ data: view });
}
