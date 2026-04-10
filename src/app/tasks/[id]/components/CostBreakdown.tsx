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
    return <p className="text-xs text-gray-600">No cost data yet</p>;
  }

  return (
    <div className="space-y-2">
      {Object.entries(costs).map(([stage, cost]) => (
        <div key={stage}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-500">{stage}</span>
            <span className="text-gray-400">${cost.toFixed(4)}</span>
          </div>
          <div className="h-1 rounded bg-gray-800">
            <div
              className={`h-full rounded transition-all duration-500 ${stageColors[stage] ?? 'bg-gray-600'}`}
              style={{ width: `${total > 0 ? (cost / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
      <div className="flex justify-between text-xs pt-1 border-t border-gray-800">
        <span className="text-gray-400 font-medium">Total</span>
        <span className="text-gray-300 font-medium">${total.toFixed(4)}</span>
      </div>
    </div>
  );
}
