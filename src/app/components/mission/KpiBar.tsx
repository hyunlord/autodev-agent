'use client';

import { useTranslations } from '@/i18n/context';

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
  const t = useTranslations('kpi');

  return (
    <div data-tour="kpi-bar" className="grid grid-cols-4 gap-3 px-5 py-4 border-t border-gray-800">
      <KpiCard
        label={t('todayTasks')}
        value={todayTotal}
        sub={`${completedToday} ${t('completed')}`}
      />
      <KpiCard
        label={t('successRate')}
        value={`${successRate}%`}
        sub={todayTotal > 0 ? t('ofTasks', { count: todayTotal }) : t('noTasks')}
      />
      <KpiCard
        label={t('totalCost')}
        value={`$${totalCost.toFixed(2)}`}
        sub={avgCost > 0 ? t('avgPerTask', { amount: avgCost.toFixed(2) }) : t('noCost')}
      />
      <KpiCard
        label={t('avgScore')}
        value={avgScore > 0 ? avgScore.toFixed(1) : '-'}
        sub={scoredTasks > 0 ? t('acrossTasks', { count: scoredTasks }) : t('noScored')}
      />
    </div>
  );
}
