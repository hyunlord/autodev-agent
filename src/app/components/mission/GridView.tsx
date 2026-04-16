'use client';

import GridTile from './GridTile';

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

export default function GridView({ tasks, onNewTask }: { tasks: Task[]; onNewTask?: () => void }) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="text-4xl mb-4" style={{ color: 'var(--text-secondary)' }}>&#9881;</div>
        <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>No tasks yet</h3>
        <p className="text-sm mb-6 max-w-md" style={{ color: 'var(--text-secondary)' }}>
          Create your first task and AutoDev will automatically plan, code, and verify it.
        </p>
        {onNewTask && (
          <button onClick={onNewTask}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors">
            Create your first task
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
      {tasks.slice(0, 9).map((task) => (
        <GridTile key={task.id} task={task} />
      ))}
    </div>
  );
}
