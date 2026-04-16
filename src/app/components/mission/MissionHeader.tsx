'use client';

import Link from 'next/link';
import ThemeToggle from '../ThemeToggle';
import LanguageToggle from '../LanguageToggle';
import { useTranslations } from '@/i18n/context';

const VIEW_IDS = ['kanban', 'grid', 'timeline', 'projects'] as const;

type ViewType = 'kanban' | 'grid' | 'timeline' | 'projects';

interface MissionHeaderProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
  activeTasks: number;
  todayCost: number;
  onNewTask: () => void;
}

export default function MissionHeader({ activeView, onViewChange, activeTasks, todayCost, onNewTask }: MissionHeaderProps) {
  const tv = useTranslations('views');
  const th = useTranslations('header');

  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
      <div className="flex items-center gap-5">
        <Link href="/" className="text-lg font-bold text-gray-100 hover:text-indigo-400 transition-colors">AutoDev</Link>
        <div data-tour="view-tabs" role="tablist" aria-label="View mode" className="flex gap-1 bg-gray-900 rounded-lg p-0.5">
          {VIEW_IDS.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={activeView === id}
              aria-controls={`${id}-panel`}
              onClick={() => onViewChange(id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeView === id
                  ? 'bg-indigo-500/15 text-indigo-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tv(id)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4">
        {activeTasks > 0 && (
          <span data-tour="active-count" className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {th('active', { count: activeTasks })}
          </span>
        )}
        {todayCost > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400">
            {th('today', { amount: todayCost.toFixed(2) })}
          </span>
        )}
        <Link
          href="/usage"
          className="px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-300 bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors"
        >
          {th('usage')}
        </Link>
        <Link
          href="/harness"
          className="px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-300 bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors"
        >
          {th('harness')}
        </Link>
        <LanguageToggle />
        <ThemeToggle />
        <button
          onClick={() => {
            if (!window.confirm('Reset all UI preferences?')) return;
            Object.keys(localStorage).forEach(key => {
              if (key.startsWith('autodev-')) localStorage.removeItem(key);
            });
            localStorage.removeItem('autodev-onboarding-done');
            window.location.reload();
          }}
          className="px-2 py-1 text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
          title="Reset all UI preferences"
        >
          {th('resetPrefs')}
        </button>
        <button
          data-tour="new-task"
          onClick={onNewTask}
          className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
        >
          {th('newTask')}
        </button>
      </div>
    </div>
  );
}
