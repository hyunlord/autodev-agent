import type { tasks } from '@/lib/db/schema';

type TaskRow = typeof tasks.$inferSelect;

export interface TriggerContext {
  kind: 'task_created' | 'schedule' | 'webhook' | 'manual';
  taskId: string;
  userId?: string;
  projectId: string;
  createdAt: string;
  category?: string;
  priority?: string;
}

export function buildTriggerContext(task: TaskRow): TriggerContext {
  return {
    kind: 'task_created',
    taskId: task.id,
    projectId: task.projectId ?? '',
    createdAt: task.createdAt,
  };
}
