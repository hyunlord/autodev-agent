'use client';

import Link from 'next/link';

interface Task {
  id: string;
  prompt: string;
  status: string;
  agentId: string;
  projectDir: string | null;
  result: unknown;
  createdAt: string;
  updatedAt: string;
}

function getProgress(status: string): number {
  const stages: Record<string, number> = {
    pending: 0, planning: 15, plan_review: 25, coding: 50,
    verifying: 80, retrying: 60, completed: 100, failed: 100, escalated: 100,
  };
  return stages[status] ?? 0;
}

function getBorderColor(column: string): string {
  if (column === 'running') return 'border-blue-500/30';
  if (column === 'review') return 'border-amber-500/30';
  if (column === 'failed') return 'border-red-500/30';
  if (column === 'done') return 'border-emerald-500/20';
  return 'border-gray-800';
}

function getStatusBadge(status: string): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: 'Queued', className: 'bg-gray-700 text-gray-400' },
    planning: { label: 'Planning', className: 'bg-blue-900/50 text-blue-400' },
    coding: { label: 'Coding', className: 'bg-blue-900/50 text-blue-400' },
    verifying: { label: 'Verifying', className: 'bg-blue-900/50 text-blue-400' },
    retrying: { label: 'Retrying', className: 'bg-orange-900/50 text-orange-400' },
    plan_review: { label: 'Review', className: 'bg-amber-900/50 text-amber-400' },
    interview: { label: 'Interview', className: 'bg-amber-900/50 text-amber-400' },
    completed: { label: 'Done', className: 'bg-emerald-900/50 text-emerald-400' },
    failed: { label: 'Failed', className: 'bg-red-900/50 text-red-400' },
    escalated: { label: 'Escalated', className: 'bg-red-900/50 text-red-400' },
  };
  return map[status] ?? { label: status, className: 'bg-gray-700 text-gray-400' };
}

function parseResult(result: unknown): Record<string, unknown> | null {
  if (!result) return null;
  if (typeof result === 'string') {
    try { return JSON.parse(result); } catch { return null; }
  }
  return result as Record<string, unknown>;
}

interface KanbanCardProps {
  task: Task;
  column: string;
}

export default function KanbanCard({ task, column }: KanbanCardProps) {
  const progress = getProgress(task.status);
  const badge = getStatusBadge(task.status);
  const projectName = task.projectDir ? task.projectDir.split('/').pop() : null;
  const result = parseResult(task.result);
  const cost = result?.costUsd ?? result?.totalCostUsd;

  const handleApprove = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });
  };

  const handleRetry = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: task.prompt, projectDir: task.projectDir }),
    });
  };

  return (
    <Link href={`/tasks/${task.id}`}>
      <div role="article" aria-label={`Task: ${task.prompt.slice(0, 50)}`} className={`p-3 bg-gray-900 rounded-lg border ${getBorderColor(column)} hover:border-gray-600 transition-colors cursor-pointer ${column === 'done' ? 'opacity-70' : ''}`}>
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <p className="text-sm text-gray-200 line-clamp-2 leading-tight">{task.prompt}</p>
          <span aria-label={`Status: ${badge.label}`} role="status" className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.className}`}>
            {badge.label}
          </span>
        </div>

        {projectName && (
          <p className="text-[10px] text-gray-600 font-mono truncate mb-2">{projectName}</p>
        )}

        {column === 'running' && (
          <div className="mb-2">
            <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
              <span>{task.status}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          {task.agentId && <span>{task.agentId}</span>}
          {cost != null && <span>${Number(cost).toFixed(2)}</span>}
        </div>

        {column === 'review' && (
          <div className="flex gap-1.5 mt-2">
            <button
              onClick={handleApprove}
              className="flex-1 px-2 py-1 text-[10px] font-medium bg-amber-600 hover:bg-amber-500 rounded transition-colors"
            >
              Approve
            </button>
            <Link
              href={`/tasks/${task.id}`}
              className="flex-1 px-2 py-1 text-[10px] font-medium text-center bg-gray-800 hover:bg-gray-700 rounded transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              Edit
            </Link>
          </div>
        )}

        {column === 'failed' && (
          <button
            onClick={handleRetry}
            className="mt-2 w-full px-2 py-1 text-[10px] font-medium bg-gray-800 hover:bg-gray-700 text-red-400 rounded transition-colors"
          >
            Retry
          </button>
        )}

        {column === 'done' && result?.score != null && (
          <div className="mt-1.5 text-[10px] text-emerald-400">
            Score: {String(result.score)}
          </div>
        )}
      </div>
    </Link>
  );
}
