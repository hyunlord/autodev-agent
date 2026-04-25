type Status = 'running' | 'completed' | 'failed' | 'cancelled' | 'resumed' | 'initializing' | string;

const STATUS_STYLES: Record<string, { dot: string; text: string; pulse: boolean }> = {
  initializing: { dot: 'bg-[var(--border-color)]', text: 'text-[var(--text-secondary)]', pulse: false },
  running:      { dot: 'bg-blue-500',              text: 'text-blue-400',                pulse: true  },
  resumed:      { dot: 'bg-purple-500',            text: 'text-purple-400',               pulse: true  },
  completed:    { dot: 'bg-emerald-500',           text: 'text-emerald-400',              pulse: false },
  failed:       { dot: 'bg-red-500',               text: 'text-red-400',                  pulse: false },
  cancelled:    { dot: 'bg-gray-500',              text: 'text-gray-400',                 pulse: false },
};

export function StatusBadge({ status }: { status: Status }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.initializing;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`w-2 h-2 rounded-full ${style.dot} ${style.pulse ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      <span className={`text-xs font-medium ${style.text}`}>{status}</span>
    </span>
  );
}
