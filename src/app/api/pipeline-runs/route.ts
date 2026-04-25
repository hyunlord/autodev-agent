import { NextResponse } from 'next/server';
import {
  listPipelineRunsByTask,
  listPipelineRunsByProject,
} from '@/lib/db/queries/pipeline-runs';

/**
 * Stage 7 G0 — list pipeline runs.
 *
 *   GET /api/pipeline-runs?taskId=...                        → all runs for task
 *   GET /api/pipeline-runs?projectId=...&limit=&offset=     → paginated by project
 *
 * Exactly one of `taskId` / `projectId` must be supplied.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get('taskId');
  const projectId = url.searchParams.get('projectId');

  if (!taskId && !projectId) {
    return NextResponse.json(
      { error: 'INVALID_QUERY', message: 'Either taskId or projectId is required' },
      { status: 400 },
    );
  }
  if (taskId && projectId) {
    return NextResponse.json(
      { error: 'INVALID_QUERY', message: 'Specify only one of taskId or projectId' },
      { status: 400 },
    );
  }

  if (taskId) {
    const rows = listPipelineRunsByTask(taskId);
    return NextResponse.json({ data: rows });
  }

  // projectId path
  const limit = parseIntSafe(url.searchParams.get('limit'));
  const offset = parseIntSafe(url.searchParams.get('offset'));
  const rows = listPipelineRunsByProject(projectId!, { limit, offset });
  return NextResponse.json({ data: rows });
}

function parseIntSafe(raw: string | null): number | undefined {
  if (raw == null) return undefined;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? undefined : n;
}
