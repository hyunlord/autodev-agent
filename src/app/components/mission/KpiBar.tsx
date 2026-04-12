'use client';

interface KpiBarProps {
  todayTotal: number;
  completedToday: number;
  successRate: number;
  totalCost: number;
  avgCost: number;
  avgScore: number;
  scoredTasks: number;
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-lg font-bold text-gray-200">{value}</p>
      <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>
    </div>
  );
}

export default function KpiBar({ todayTotal, completedToday, successRate, totalCost, avgCost, avgScore, scoredTasks }: KpiBarProps) {
  return (
    <div data-tour="kpi-bar" className="grid grid-cols-4 gap-3 px-5 py-4 border-t border-gray-800">
      <KpiCard
        label="Today's tasks"
        value={todayTotal}
        sub={`${completedToday} completed`}
      />
      <KpiCard
        label="Success rate"
        value={`${successRate}%`}
        sub={todayTotal > 0 ? `of ${todayTotal} tasks` : 'no tasks today'}
      />
      <KpiCard
        label="Total cost"
        value={`$${totalCost.toFixed(2)}`}
        sub={avgCost > 0 ? `avg $${avgCost.toFixed(2)}/task` : 'no cost data'}
      />
      <KpiCard
        label="Avg verify score"
        value={avgScore > 0 ? avgScore.toFixed(1) : '-'}
        sub={scoredTasks > 0 ? `across ${scoredTasks} tasks` : 'no scored tasks'}
      />
    </div>
  );
}
