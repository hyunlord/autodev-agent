'use client';

import Link from 'next/link';
import { type TaskDetail, type LiveUsage, getStatusColor, getStatusTextColor, formatElapsed } from './types';

interface Props {
  task: TaskDetail;
  currentStatus: string;
  liveUsage: LiveUsage;
  attemptCount: number;
}

export function TaskHeader({ task, currentStatus, liveUsage, attemptCount }: Props) {
  const isRunning = !['completed', 'failed', 'escalated'].includes(currentStatus);

  return (
    <div className="flex items-center justify-between px-5 py-3 border-b" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
      <div className="flex items-center gap-3">
        <Link href="/" className="hover:opacity-80 text-sm transition-colors" style={{ color: 'var(--text-secondary)' }}>
          &larr; Dashboard
        </Link>
        <span style={{ color: 'var(--border-color)' }}>/</span>
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Task #{task.id.slice(0, 6)}</span>
        {attemptCount > 1 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
            Attempt {attemptCount}/3
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${getStatusColor(currentStatus)} ${isRunning ? 'animate-pulse' : ''}`} />
          <span className={`text-xs capitalize ${getStatusTextColor(currentStatus)}`}>
            {currentStatus === 'plan_review' ? 'review' : currentStatus}
          </span>
        </div>
        {(liveUsage.totalCostUsd > 0 || isRunning) && (
          <>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400">
              ${liveUsage.totalCostUsd.toFixed(4)}
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400">
              {(liveUsage.totalInputTokens + liveUsage.totalOutputTokens).toLocaleString()} tok
            </span>
          </>
        )}
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {formatElapsed(task.createdAt, ['completed', 'failed', 'escalated'].includes(currentStatus) ? task.updatedAt : undefined)}
        </span>
      </div>
    </div>
  );
}
