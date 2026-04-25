import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  listPipelineRunsByProject,
  countPipelineRunsByProject,
  type PipelineRunRow,
} from '@/lib/db/queries/pipeline-runs';
import { formatDuration, formatRelativeTime, truncateId } from '@/lib/utils/format';
import { StatusBadge } from './_components/StatusBadge';
import { FilterBar } from './_components/FilterBar';
import { Pagination } from './_components/Pagination';
import { clampPageRedirectTarget } from './_lib/clamp-page';

const PAGE_SIZE = 20;

interface PageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ status?: string; taskId?: string; page?: string }>;
}

/**
 * Stage 7 G1 — Pipeline Run list page (Server Component).
 *
 * Read-only list scoped to a single project. Filters and pagination are
 * URL-driven (status / taskId / page query params). Uses the existing
 * CSS-variable-based dark theme — no new design tokens.
 */
export default async function PipelineRunsPage({ params, searchParams }: PageProps) {
  const { projectId } = await params;
  const sp = await searchParams;

  const status = sp.status && sp.status !== 'all' ? sp.status : undefined;
  const taskIdLike = sp.taskId?.trim() || undefined;
  const requestedPage = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  // count() first so we can clamp out-of-range page requests before fetching.
  const total = countPipelineRunsByProject(projectId, { status, taskIdLike });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // G1 micro-fix — when requestedPage exceeds totalPages AND there are rows,
  // redirect to the last valid page (URL stays in sync with what's rendered).
  const redirectTarget = clampPageRedirectTarget({
    projectId,
    requestedPage,
    totalPages,
    total,
    status: sp.status,
    taskId: sp.taskId,
  });
  if (redirectTarget) redirect(redirectTarget);

  const page = requestedPage;
  const offset = (page - 1) * PAGE_SIZE;

  const runs = listPipelineRunsByProject(projectId, {
    status,
    taskIdLike,
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          Pipeline Runs
        </h1>
        <p className="text-sm mt-1 font-mono" style={{ color: 'var(--text-secondary)' }}>
          {projectId}
        </p>
      </header>

      <FilterBar
        projectId={projectId}
        initialStatus={sp.status}
        initialTaskId={sp.taskId}
      />

      <div
        className="rounded border"
        style={{
          background: 'var(--bg-card)',
          borderColor: 'var(--border-color)',
        }}
      >
        {runs.length === 0 ? (
          <EmptyState hasFilter={!!status || !!taskIdLike} />
        ) : (
          <RunsTable runs={runs} />
        )}
      </div>

      <p className="text-xs mt-3 text-right" style={{ color: 'var(--text-secondary)' }}>
        {total} run{total === 1 ? '' : 's'} total
      </p>

      <Pagination
        projectId={projectId}
        currentPage={page}
        totalPages={totalPages}
        searchParams={{ status: sp.status, taskId: sp.taskId }}
      />
    </div>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="py-16 text-center" style={{ color: 'var(--text-secondary)' }}>
      <p className="text-sm">
        {hasFilter ? '필터 조건과 일치하는 실행 기록이 없습니다.' : '아직 실행 기록이 없습니다.'}
      </p>
    </div>
  );
}

function RunsTable({ runs }: { runs: PipelineRunRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr
            className="text-left text-xs"
            style={{
              color: 'var(--text-secondary)',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            <th className="py-2 px-3 font-medium">Run ID</th>
            <th className="py-2 px-3 font-medium">Task</th>
            <th className="py-2 px-3 font-medium">Status</th>
            <th className="py-2 px-3 font-medium">Started</th>
            <th className="py-2 px-3 font-medium">Duration</th>
            <th className="py-2 px-3 font-medium">Nodes</th>
            <th className="py-2 px-3 font-medium">Error</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunRow({ run }: { run: PipelineRunRow }) {
  const duration = computeDurationMs(run.startedAt, run.completedAt);
  const errorMsg = extractErrorMessage(run.error);
  const nodes = `${run.nodesCompleted ?? 0}/${run.nodesFailed ?? 0}`;
  return (
    <tr
      className="hover:bg-[color:var(--bg-primary)]/40"
      style={{ borderBottom: '1px solid var(--border-color)' }}
    >
      <td className="py-2 px-3 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
        {truncateId(run.id)}
      </td>
      <td className="py-2 px-3 font-mono text-xs">
        <Link
          href={`/tasks/${run.taskId}`}
          className="text-blue-400 hover:underline"
          title={run.taskId}
        >
          {truncateId(run.taskId)}
        </Link>
      </td>
      <td className="py-2 px-3">
        <StatusBadge status={run.status} />
      </td>
      <td className="py-2 px-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {formatRelativeTime(run.startedAt)}
      </td>
      <td className="py-2 px-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {formatDuration(duration)}
      </td>
      <td className="py-2 px-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {nodes}
      </td>
      <td
        className="py-2 px-3 text-xs max-w-xs truncate text-red-400"
        title={errorMsg ?? ''}
      >
        {errorMsg ?? ''}
      </td>
    </tr>
  );
}

function computeDurationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const s = new Date(startedAt).getTime();
  const e = new Date(completedAt).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  return e - s;
}

function extractErrorMessage(err: unknown): string | null {
  if (err == null) return null;
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const m = (err as Record<string, unknown>).message;
    if (typeof m === 'string') return m;
  }
  return null;
}
