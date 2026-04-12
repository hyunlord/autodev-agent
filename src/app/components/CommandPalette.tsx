'use client';

import { useState, useEffect } from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';

interface TaskItem {
  id: string;
  prompt: string;
  status: string;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const router = useRouter();

  // Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Fetch tasks when opened
  useEffect(() => {
    if (open) {
      fetch('/api/tasks?limit=10')
        .then(r => r.json())
        .then(data => setTasks(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <Command className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
          <Command.Input
            placeholder="Search tasks, pages, actions..."
            className="w-full px-4 py-3 text-sm bg-transparent border-b border-gray-800 text-gray-100 placeholder:text-gray-500 outline-none"
            autoFocus
          />
          <Command.List className="max-h-[300px] overflow-y-auto p-2">
            <Command.Empty className="text-sm text-gray-500 text-center py-6">
              No results found
            </Command.Empty>

            <Command.Group heading="Pages" className="text-xs text-gray-500 px-2 py-1.5">
              <Command.Item
                onSelect={() => { router.push('/'); setOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 text-sm text-gray-300 rounded-lg cursor-pointer data-[selected]:bg-gray-800"
              >
                <span className="text-gray-500">&#9776;</span> Mission Control
              </Command.Item>
              <Command.Item
                onSelect={() => { router.push('/usage'); setOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 text-sm text-gray-300 rounded-lg cursor-pointer data-[selected]:bg-gray-800"
              >
                <span className="text-gray-500">$</span> Usage Dashboard
              </Command.Item>
              <Command.Item
                onSelect={() => { router.push('/harness'); setOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 text-sm text-gray-300 rounded-lg cursor-pointer data-[selected]:bg-gray-800"
              >
                <span className="text-gray-500">&#9881;</span> Harness Settings
              </Command.Item>
            </Command.Group>

            {tasks.length > 0 && (
              <Command.Group heading="Recent tasks" className="text-xs text-gray-500 px-2 py-1.5">
                {tasks.slice(0, 8).map(task => (
                  <Command.Item
                    key={task.id}
                    value={task.prompt}
                    onSelect={() => { router.push(`/tasks/${task.id}`); setOpen(false); }}
                    className="flex items-center gap-3 px-3 py-2 text-sm text-gray-300 rounded-lg cursor-pointer data-[selected]:bg-gray-800"
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      task.status === 'completed' ? 'bg-emerald-500' :
                      task.status === 'failed' ? 'bg-red-500' :
                      'bg-blue-500 animate-pulse'
                    }`} />
                    <span className="truncate">{task.prompt.slice(0, 60)}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="Actions" className="text-xs text-gray-500 px-2 py-1.5">
              <Command.Item
                onSelect={() => { router.push('/?newTask=1'); setOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 text-sm text-gray-300 rounded-lg cursor-pointer data-[selected]:bg-gray-800"
              >
                <span className="text-gray-500">+</span> New task
              </Command.Item>
            </Command.Group>
          </Command.List>

          <div className="border-t border-gray-800 px-4 py-2 text-xs text-gray-600 flex gap-4">
            <span>&#8593;&#8595; navigate</span>
            <span>&#9166; select</span>
            <span>esc close</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
