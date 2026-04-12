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

function getAccentColor(status: string): string {
  if (['planning', 'coding', 'verifying', 'retrying'].includes(status)) return 'bg-blue-500';
  if (['plan_review', 'interview'].includes(status)) return 'bg-amber-500';
  if (status === 'completed') return 'bg-emerald-500';
  if (['failed', 'escalated'].includes(status)) return 'bg-red-500';
  return 'bg-gray-600';
}

function getBorderColor(status: string): string {
  if (['planning', 'coding', 'verifying', 'retrying'].includes(status)) return 'border-blue-500/20';
  if (['plan_review', 'interview'].includes(status)) return 'border-amber-500/20';
  if (status === 'completed') return 'border-emerald-500/20';
  if (['failed', 'escalated'].includes(status)) return 'border-red-500/20';
  return 'border-gray-800';
}

function getStatusDot(status: string): { color: string; pulse: boolean; label: string } {
  if (['planning', 'coding', 'verifying', 'retrying'].includes(status))
    return { color: 'bg-blue-500', pulse: true, label: status };
  if (['plan_review', 'interview'].includes(status))
    return { color: 'bg-amber-500', pulse: false, label: 'review' };
  if (status === 'completed')
    return { color: 'bg-emerald-500', pulse: false, label: 'done' };
  if (['failed', 'escalated'].includes(status))
    return { color: 'bg-red-500', pulse: false, label: 'failed' };
  return { color: 'bg-gray-500', pulse: false, label: status };
}

function parseResult(result: unknown): Record<string, unknown> | null {
  if (!result) return null;
  if (typeof result === 'string') {
    try { return JSON.parse(result); } catch { return null; }
  }
  return result as Record<string, unknown>;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export default function GridTile({ task }: { task: Task }) {
  const progress = getProgress(task.status);
  const dot = getStatusDot(task.status);
  const projectName = task.projectDir ? task.projectDir.split('/').pop() : null;
  const result = parseResult(task.result);
  const cost = result?.costUsd ?? result?.totalCostUsd;
  const duration = task.updatedAt && task.createdAt
    ? Math.round((new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime()) / 1000)
    : null;

  return (
    <Link href={`/tasks/${task.id}`}>
      <div className={`relative bg-gray-900 rounded-lg border ${getBorderColor(task.status)} hover:border-gray-600 transition-colors cursor-pointer overflow-hidden ${task.status === 'completed' ? 'opacity-70' : ''}`}>
        {/* Top progress bar */}
        <div className="h-[3px] w-full bg-gray-800">
          <div
            className={`h-full ${getAccentColor(task.status)} transition-all duration-500`}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="text-sm text-gray-200 line-clamp-2 leading-tight flex-1">{task.prompt}</p>
            <span className="flex items-center gap-1 shrink-0">
              <span className={`w-1.5 h-1.5 rounded-full ${dot.color} ${dot.pulse ? 'animate-pulse' : ''}`} />
              <span className="text-[10px] text-gray-500">{dot.label}</span>
            </span>
          </div>

          {projectName && (
            <p className="text-[10px] text-gray-600 font-mono truncate mb-3">{projectName}</p>
          )}

          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <div>
              <p className="text-gray-600">Agent</p>
              <p className="text-gray-400 truncate">{task.agentId || '-'}</p>
            </div>
            <div>
              <p className="text-gray-600">Cost</p>
              <p className="text-gray-400">{cost != null ? `$${Number(cost).toFixed(2)}` : '-'}</p>
            </div>
            <div>
              <p className="text-gray-600">Time</p>
              <p className="text-gray-400">{duration && duration > 0 ? formatDuration(duration) : '-'}</p>
            </div>
          </div>

          {task.status === 'completed' && result?.score != null && (
            <div className="mt-2 text-[10px] text-emerald-400">Score: {String(result.score)}</div>
          )}
        </div>
      </div>
    </Link>
  );
}
