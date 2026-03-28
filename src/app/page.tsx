'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Task {
  id: string;
  prompt: string;
  status: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-700 text-gray-300',
  planning: 'bg-blue-900 text-blue-300',
  coding: 'bg-purple-900 text-purple-300',
  verifying: 'bg-yellow-900 text-yellow-300',
  retrying: 'bg-orange-900 text-orange-300',
  completed: 'bg-green-900 text-green-300',
  failed: 'bg-red-900 text-red-300',
  escalated: 'bg-red-900 text-red-300',
};

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [prompt, setPrompt] = useState('');
  const [projectDir, setProjectDir] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string>('checking...');

  const fetchTasks = async () => {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    setTasks(data);
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(d => setAgentStatus(d.claudeCode ? 'Claude Code available' : 'Claude Code not found')).catch(() => setAgentStatus('status unknown'));
  }, []);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    setSubmitting(true);
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, projectDir: projectDir || undefined }),
    });
    if (res.ok) {
      setPrompt('');
      await fetchTasks();
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen p-8 max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">AutoDev Agent</h1>
        <p className="text-gray-400 mt-1">Universal AI Development Orchestrator</p>
      </header>

      <p className={`text-sm mb-4 ${agentStatus.includes('available') ? 'text-green-400' : 'text-yellow-400'}`}>
        Agent: {agentStatus}
      </p>

      <section className="mb-8 p-6 bg-gray-900 rounded-xl border border-gray-800">
        <h2 className="text-lg font-semibold mb-4">New Task</h2>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what you want to build or change..."
          rows={3}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
        />
        <div className="mt-3 flex gap-3">
          <input
            type="text"
            value={projectDir}
            onChange={(e) => setProjectDir(e.target.value)}
            placeholder="Project directory (optional)"
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim() || submitting}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
          >
            {submitting ? 'Submitting...' : 'Run'}
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4">Tasks</h2>
        {tasks.length === 0 ? (
          <p className="text-gray-500">No tasks yet. Create one above.</p>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <Link
                key={task.id}
                href={`/tasks/${task.id}`}
                className="block p-4 bg-gray-900 rounded-lg border border-gray-800 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <p className="text-gray-100 truncate flex-1 mr-4">{task.prompt}</p>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[task.status] ?? 'bg-gray-700 text-gray-300'}`}>
                    {task.status}
                  </span>
                </div>
                <p className="text-gray-500 text-sm mt-1">
                  {new Date(task.createdAt).toLocaleString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
