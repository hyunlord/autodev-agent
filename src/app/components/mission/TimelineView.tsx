'use client';

import TimelineRow from './TimelineRow';

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

interface TaskEvent {
  type: string;
  data: unknown;
  createdAt: string;
}

const LEGEND = [
  { label: 'planning', color: 'bg-amber-500/40' },
  { label: 'coding', color: 'bg-blue-500/40' },
  { label: 'verifying', color: 'bg-emerald-500/40' },
  { label: 'completed', color: 'bg-violet-500/40' },
  { label: 'failed', color: 'bg-red-500/40' },
];

export default function TimelineView({ tasks, events }: { tasks: Task[]; events: Record<string, TaskEvent[]> }) {
  // Calculate time range from tasks
  const allTimes = tasks.map(t => new Date(t.createdAt).getTime());
  const start = allTimes.length > 0 ? Math.min(...allTimes) : Date.now() - 30 * 60 * 1000;
  const end = Date.now();
  const timeRange = { start, end };

  // Time axis labels
  const labelCount = 6;
  const totalMs = end - start;
  const labels = Array.from({ length: labelCount }, (_, i) => {
    const t = start + (totalMs / (labelCount - 1)) * i;
    return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  return (
    <div className="min-w-[700px]">
      {/* Time axis header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-48 shrink-0" />
        <div className="flex-1 flex justify-between text-[10px] text-gray-600">
          {labels.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
      </div>

      {/* Task rows */}
      <div aria-live="polite" aria-label="Pipeline events">
      {tasks.length === 0 ? (
        <p className="text-center text-gray-600 py-12">No tasks yet</p>
      ) : (
        tasks.map((task) => (
          <TimelineRow
            key={task.id}
            task={task}
            events={events[task.id] ?? []}
            timeRange={timeRange}
          />
        ))
      )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-800">
        {LEGEND.map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className={`w-3 h-2 rounded-sm ${l.color}`} />
            <span className="text-[10px] text-gray-500">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
