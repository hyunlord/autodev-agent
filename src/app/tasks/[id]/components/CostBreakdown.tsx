'use client';

interface Props {
  costs: Record<string, number>;
}

const stageColors: Record<string, string> = {
  planning: 'bg-amber-500',
  coding: 'bg-indigo-500',
  verify: 'bg-emerald-500',
  vlm: 'bg-violet-500',
};

export function CostBreakdown({ costs }: Props) {
  const total = Object.values(costs).reduce((s, v) => s + v, 0);

  if (total === 0) {
    return <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No cost data yet</p>;
  }

  return (
    <div className="space-y-2">
      {Object.entries(costs).map(([stage, cost]) => (
        <div key={stage}>
          <div className="flex justify-between text-xs mb-1">
            <span style={{ color: 'var(--text-secondary)' }}>{stage}</span>
            <span style={{ color: 'var(--text-secondary)' }}>${cost.toFixed(4)}</span>
          </div>
          <div className="h-1 rounded" style={{ background: 'var(--bg-card)' }}>
            <div
              className={`h-full rounded transition-all duration-500 ${stageColors[stage] ?? 'bg-[var(--border-color)]'}`}
              style={{ width: `${total > 0 ? (cost / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
      <div className="flex justify-between text-xs pt-1 border-t" style={{ borderColor: 'var(--border-color)' }}>
        <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>Total</span>
        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>${total.toFixed(4)}</span>
      </div>
    </div>
  );
}
