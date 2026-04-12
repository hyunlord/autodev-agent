'use client';

import Link from 'next/link';

const VIEWS = [
  { id: 'kanban' as const, label: 'Kanban' },
  { id: 'grid' as const, label: 'Grid' },
  { id: 'timeline' as const, label: 'Timeline' },
];

interface MissionHeaderProps {
  activeView: 'kanban' | 'grid' | 'timeline';
  onViewChange: (view: 'kanban' | 'grid' | 'timeline') => void;
  activeTasks: number;
  todayCost: number;
  onNewTask: () => void;
}

export default function MissionHeader({ activeView, onViewChange, activeTasks, todayCost, onNewTask }: MissionHeaderProps) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
      <div className="flex items-center gap-5">
        <h1 className="text-lg font-bold text-gray-100">AutoDev</h1>
        <div data-tour="view-tabs" role="tablist" aria-label="View mode" className="flex gap-1 bg-gray-900 rounded-lg p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={activeView === v.id}
              aria-controls={`${v.id}-panel`}
              onClick={() => onViewChange(v.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeView === v.id
                  ? 'bg-indigo-500/15 text-indigo-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4">
        {activeTasks > 0 && (
          <span data-tour="active-count" className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {activeTasks} active
          </span>
        )}
        {todayCost > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400">
            ${todayCost.toFixed(2)} today
          </span>
        )}
        <Link
          href="/usage"
          className="px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-300 bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors"
        >
          Usage
        </Link>
        <Link
          href="/harness"
          className="px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-300 bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors"
        >
          Harness
        </Link>
        <button
          data-tour="new-task"
          onClick={onNewTask}
          className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
        >
          + New task
        </button>
      </div>
    </div>
  );
}
