'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface FilterBarProps {
  projectId: string;
  initialStatus?: string;
  initialTaskId?: string;
}

const STATUS_OPTIONS = ['all', 'running', 'completed', 'failed', 'cancelled', 'resumed'] as const;

export function FilterBar({ projectId, initialStatus, initialTaskId }: FilterBarProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus ?? 'all');
  const [taskId, setTaskId] = useState(initialTaskId ?? '');

  function applyFilters() {
    const params = new URLSearchParams();
    if (status && status !== 'all') params.set('status', status);
    if (taskId.trim()) params.set('taskId', taskId.trim());
    const qs = params.toString();
    router.push(`/pipeline-runs/${projectId}${qs ? `?${qs}` : ''}`);
  }

  function reset() {
    setStatus('all');
    setTaskId('');
    router.push(`/pipeline-runs/${projectId}`);
  }

  return (
    <div className="flex flex-wrap gap-3 items-center mb-4">
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="px-3 py-1.5 text-sm rounded border"
        style={{
          background: 'var(--bg-card)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-primary)',
        }}
        aria-label="status filter"
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>{s === 'all' ? 'All status' : s}</option>
        ))}
      </select>

      <input
        type="text"
        placeholder="Task ID contains..."
        value={taskId}
        onChange={(e) => setTaskId(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
        className="px-3 py-1.5 text-sm rounded border font-mono"
        style={{
          background: 'var(--bg-card)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-primary)',
          minWidth: 200,
        }}
        aria-label="task id filter"
      />

      <button
        onClick={applyFilters}
        className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white"
      >
        Apply
      </button>

      <button
        onClick={reset}
        className="px-3 py-1.5 text-sm rounded border"
        style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
      >
        Reset
      </button>
    </div>
  );
}
