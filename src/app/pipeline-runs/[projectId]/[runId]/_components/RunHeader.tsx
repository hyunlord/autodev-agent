import Link from 'next/link';
import { StatusBadge } from '../../_components/StatusBadge';
import { formatDuration, formatRelativeTime, truncateId } from '@/lib/utils/format';
import type { PipelineRunRow } from '@/lib/db/queries/pipeline-runs';

function computeDurationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const s = Date.parse(startedAt);
  const e = Date.parse(completedAt);
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

export function RunHeader({ run, projectId }: { run: PipelineRunRow; projectId: string }) {
  const errorMsg = extractErrorMessage(run.error);
  const duration = computeDurationMs(run.startedAt, run.completedAt);
  const nodes = `${run.nodesCompleted ?? 0} / ${run.nodesFailed ?? 0}`;

  return (
    <section
      className="rounded border p-4 space-y-4"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/pipeline-runs/${projectId}`}
            className="text-xs hover:underline"
            style={{ color: 'var(--text-secondary)' }}
          >
            ← Back to runs
          </Link>
          <h1
            className="text-xl font-semibold mt-1"
            style={{ color: 'var(--text-primary)' }}
          >
            Run {truncateId(run.id)}
          </h1>
          <p className="text-xs font-mono mt-0.5 break-all" style={{ color: 'var(--text-secondary)' }}>
            {run.id}
          </p>
        </div>
        <StatusBadge status={run.status} />
      </div>

      <dl
        className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm"
        style={{ color: 'var(--text-primary)' }}
      >
        <Cell label="Task">
          <Link
            href={`/tasks/${run.taskId}`}
            className="font-mono text-xs text-blue-400 hover:underline"
            title={run.taskId}
          >
            {truncateId(run.taskId)}
          </Link>
        </Cell>
        <Cell label="Started">
          <span className="text-xs">{formatRelativeTime(run.startedAt)}</span>
        </Cell>
        <Cell label="Duration">
          <span className="text-xs">{formatDuration(duration)}</span>
        </Cell>
        <Cell label="Nodes (ok / fail)">
          <span className="text-xs">{nodes}</span>
        </Cell>
      </dl>

      {errorMsg && (
        <div
          className="border-l-4 border-red-500 px-3 py-2 text-sm"
          style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#fca5a5' }}
        >
          <strong>Error: </strong>
          <span className="break-all">{errorMsg}</span>
        </div>
      )}
    </section>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
