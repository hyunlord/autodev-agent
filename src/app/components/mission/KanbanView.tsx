'use client';

import KanbanCard from './KanbanCard';
import { useTranslations } from '@/i18n/context';

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

const KANBAN_COLUMNS = [
  { id: 'queued', key: 'queued', statuses: ['pending'], dotColor: 'bg-gray-500', textColor: 'text-gray-400', pulse: false },
  { id: 'running', key: 'running', statuses: ['planning', 'coding', 'verifying', 'retrying'], dotColor: 'bg-blue-500', textColor: 'text-blue-400', pulse: true },
  { id: 'review', key: 'review', statuses: ['plan_review', 'interview'], dotColor: 'bg-amber-500', textColor: 'text-amber-400', pulse: false },
  { id: 'done', key: 'done', statuses: ['completed'], dotColor: 'bg-emerald-500', textColor: 'text-emerald-400', pulse: false },
  { id: 'failed', key: 'failed', statuses: ['failed', 'escalated'], dotColor: 'bg-red-500', textColor: 'text-red-400', pulse: false },
];

export default function KanbanView({ tasks }: { tasks: Task[] }) {
  const t = useTranslations('kanban');

  return (
    <div className="grid grid-cols-5 gap-3 min-w-[900px]">
      {KANBAN_COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => col.statuses.includes(t.status));
        return (
          <div key={col.id} role="region" aria-label={`${col.key} tasks: ${colTasks.length}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`w-2 h-2 rounded-full ${col.dotColor} ${col.pulse ? 'animate-pulse' : ''}`} />
              <span className={`text-xs font-medium ${col.textColor}`}>{t(col.key)}</span>
              <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
                {colTasks.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {colTasks.map((task) => (
                <KanbanCard key={task.id} task={task} column={col.id} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
