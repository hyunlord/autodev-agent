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

export default function GridView({ tasks }: { tasks: Task[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
      {tasks.length === 0 ? (
        <p className="col-span-3 text-center text-gray-600 py-12">No tasks yet</p>
      ) : (
        tasks.slice(0, 9).map((task) => (
          <GridTile key={task.id} task={task} />
        ))
      )}
    </div>
  );
}
