'use client';

import Link from 'next/link';
import ThemeToggle from '../ThemeToggle';
import LanguageToggle from '../LanguageToggle';
import AgentHealthBar from '../AgentHealthBar';
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
        <Link href="/" className="text-lg font-bold hover:text-indigo-400 transition-colors" style={{ color: 'var(--text-primary)' }}>AutoDev</Link>
        <div data-tour="view-tabs" role="tablist" aria-label="View mode" className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-secondary)' }}>
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
                  : 'hover:opacity-80'
              }`}
              style={activeView !== id ? { color: 'var(--text-secondary)' } : undefined}
            >
              {tv(id)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4">
        {activeTasks > 0 && (
          <span data-tour="active-count" className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
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
          className="px-2.5 py-1.5 text-xs rounded-lg transition-colors hover:opacity-80"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}
        >
          {th('usage')}
        </Link>
        <Link
          href="/harness"
          className="px-2.5 py-1.5 text-xs rounded-lg transition-colors hover:opacity-80"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}
        >
          {th('harness')}
        </Link>
        <AgentHealthBar />
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
          className="px-2 py-1 text-[10px] hover:opacity-80 transition-colors"
          style={{ color: 'var(--text-secondary)' }}
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
