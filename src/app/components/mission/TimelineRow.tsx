'use client';

interface StageRange {
  stage: string;
  start: number;
  end: number;
}

interface TaskEvent {
  type: string;
  data: unknown;
  createdAt: string;
}

interface Task {
  id: string;
  prompt: string;
  status: string;
  agentId: string;
  createdAt: string;
  updatedAt: string;
}

const STAGE_COLORS: Record<string, string> = {
  pending: 'bg-gray-700/40 text-[var(--text-secondary)]',
  planning: 'bg-amber-500/25 text-amber-400',
  plan_review: 'bg-amber-500/15 text-amber-300',
  interview: 'bg-amber-500/15 text-amber-300',
  coding: 'bg-blue-500/25 text-blue-400',
  verifying: 'bg-emerald-500/25 text-emerald-400',
  retrying: 'bg-orange-500/25 text-orange-400',
  completed: 'bg-violet-500/25 text-violet-400',
  failed: 'bg-red-500/25 text-red-400',
  escalated: 'bg-red-500/25 text-red-400',
};

function extractStageTimings(taskEvents: TaskEvent[], taskCreatedAt: string): StageRange[] {
  const ranges: StageRange[] = [];
  let currentStage = 'pending';
  let stageStart = new Date(taskCreatedAt).getTime();

  const statusEvents = taskEvents
    .filter(e => e.type === 'status_change')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  for (const event of statusEvents) {
    const data = (typeof event.data === 'string'
      ? (() => { try { return JSON.parse(event.data); } catch { return event.data; } })()
      : event.data) as Record<string, unknown> | null;

    const newStatus = data?.status as string | undefined;
    if (!newStatus) continue;

    const ts = new Date(event.createdAt).getTime();
    if (currentStage && ts > stageStart) {
      ranges.push({ stage: currentStage, start: stageStart, end: ts });
    }
    currentStage = newStatus;
    stageStart = ts;
  }

  if (currentStage) {
    ranges.push({ stage: currentStage, start: stageStart, end: Date.now() });
  }

  return ranges;
}

interface TimelineRowProps {
  task: Task;
  events: TaskEvent[];
  timeRange: { start: number; end: number };
}

export default function TimelineRow({ task, events, timeRange }: TimelineRowProps) {
  const stages = extractStageTimings(events, task.createdAt);
  const totalRange = timeRange.end - timeRange.start;
  if (totalRange <= 0) return null;

  return (
    <div className="flex items-center gap-3 py-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
      <div className="w-48 shrink-0">
        <p className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{task.prompt}</p>
        <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{task.agentId}</p>
      </div>
      <div className="flex-1 relative h-6 rounded overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
        {stages.map((s, i) => {
          const left = ((s.start - timeRange.start) / totalRange) * 100;
          const width = ((s.end - s.start) / totalRange) * 100;
          const colors = STAGE_COLORS[s.stage] ?? 'bg-gray-700/40 text-[var(--text-secondary)]';
          return (
            <div
              key={i}
              className={`absolute top-0 h-full flex items-center justify-center text-[9px] font-medium rounded-sm ${colors}`}
              style={{
                left: `${Math.max(0, Math.min(left, 100))}%`,
                width: `${Math.max(0.5, Math.min(width, 100 - left))}%`,
              }}
              title={`${s.stage}: ${Math.round((s.end - s.start) / 1000)}s`}
            >
              {width > 8 ? s.stage : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}
