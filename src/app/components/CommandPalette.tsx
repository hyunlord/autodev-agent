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
        <Command className="border rounded-xl shadow-2xl overflow-hidden" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
          <Command.Input
            placeholder="Search tasks, pages, actions..."
            className="w-full px-4 py-3 text-sm bg-transparent border-b outline-none"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            autoFocus
          />
          <Command.List className="max-h-[300px] overflow-y-auto p-2">
            <Command.Empty className="text-sm text-center py-6" style={{ color: 'var(--text-secondary)' }}>
              No results found
            </Command.Empty>

            <Command.Group heading="Pages" className="text-xs px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
              <Command.Item
                onSelect={() => { router.push('/'); setOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 text-sm rounded-lg cursor-pointer data-[selected]:opacity-80" style={{ color: 'var(--text-primary)' }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>&#9776;</span> Mission Control
              </Command.Item>
              <Command.Item
                onSelect={() => { router.push('/usage'); setOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 text-sm rounded-lg cursor-pointer data-[selected]:opacity-80" style={{ color: 'var(--text-primary)' }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>$</span> Usage Dashboard
              </Command.Item>
              <Command.Item
                onSelect={() => { router.push('/harness'); setOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 text-sm rounded-lg cursor-pointer data-[selected]:opacity-80" style={{ color: 'var(--text-primary)' }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>&#9881;</span> Harness Settings
              </Command.Item>
            </Command.Group>

            {tasks.length > 0 && (
              <Command.Group heading="Recent tasks" className="text-xs px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                {tasks.slice(0, 8).map(task => (
                  <Command.Item
                    key={task.id}
                    value={task.prompt}
                    onSelect={() => { router.push(`/tasks/${task.id}`); setOpen(false); }}
                    className="flex items-center gap-3 px-3 py-2 text-sm rounded-lg cursor-pointer data-[selected]:opacity-80" style={{ color: 'var(--text-primary)' }}
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

            <Command.Group heading="Actions" className="text-xs px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
              <Command.Item
                onSelect={() => { router.push('/?newTask=1'); setOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 text-sm rounded-lg cursor-pointer data-[selected]:opacity-80" style={{ color: 'var(--text-primary)' }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>+</span> New task
              </Command.Item>
            </Command.Group>
          </Command.List>

          <div className="border-t px-4 py-2 text-xs flex gap-4" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
            <span>&#8593;&#8595; navigate</span>
            <span>&#9166; select</span>
            <span>esc close</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
