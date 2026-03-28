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
  const [planningMode, setPlanningMode] = useState<'auto' | 'manual' | 'api'>('auto');
  const [codingPrompt, setCodingPrompt] = useState('');
  const [verificationChecklist, setVerificationChecklist] = useState('');
  const [agents, setAgents] = useState<Array<{ id: string; name: string; available: boolean; path: string | null }>>([]);
  const [selectedAgent, setSelectedAgent] = useState('claude-code');

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
    fetch('/api/status').then(r => r.json()).then(data => {
      setAgents(data.agents ?? []);
      const firstAvailable = (data.agents ?? []).find((a: any) => a.available);
      if (firstAvailable) setSelectedAgent(firstAvailable.id);
    }).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    setSubmitting(true);
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        projectDir: projectDir || undefined,
        planningMode,
        ...(planningMode === 'manual' ? { codingPrompt, verificationChecklist } : {}),
      }),
    });
    if (res.ok) {
      setPrompt('');
      setCodingPrompt('');
      setVerificationChecklist('');
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

      <div className="flex flex-wrap gap-2 mb-4">
        {agents.map(a => (
          <span key={a.id} className={`text-xs px-2 py-1 rounded ${a.available ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-600'}`}>
            {a.available ? '\u25CF' : '\u25CB'} {a.name}
          </span>
        ))}
      </div>

      <section className="mb-8 p-6 bg-gray-900 rounded-xl border border-gray-800">
        <h2 className="text-lg font-semibold mb-4">New Task</h2>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what you want to build or change..."
          rows={3}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
        />
        <div className="mt-3 flex gap-2">
          {(['auto', 'manual', 'api'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPlanningMode(mode)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                planningMode === mode
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {mode === 'auto' ? 'Auto (CLI)' : mode === 'manual' ? 'Manual' : 'API'}
            </button>
          ))}
        </div>
        {planningMode === 'auto' && (
          <p className="mt-2 text-xs text-gray-500">Uses claude CLI (OAuth) — run &apos;claude login&apos; first</p>
        )}
        {planningMode === 'api' && (
          <p className="mt-2 text-xs text-yellow-500">Requires ANTHROPIC_API_KEY in .autodev/.env</p>
        )}
        {planningMode === 'manual' && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Coding Prompt *</label>
              <textarea
                value={codingPrompt}
                onChange={(e) => setCodingPrompt(e.target.value)}
                placeholder="Detailed instruction for the coding agent..."
                rows={4}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Verification Checklist</label>
              <textarea
                value={verificationChecklist}
                onChange={(e) => setVerificationChecklist(e.target.value)}
                placeholder={"1. Button visible on page\n2. Click toggles state\n3. Persists after refresh"}
                rows={3}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>
          </div>
        )}
        <div className="mt-3">
          <label className="block text-sm text-gray-400 mb-1">Coding Agent</label>
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-indigo-500"
          >
            {agents.map(a => (
              <option key={a.id} value={a.id} disabled={!a.available}>
                {a.name} {a.available ? '' : '(not installed)'}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 flex gap-3">
          <input
            type="text"
            value={projectDir}
            onChange={(e) => setProjectDir(e.target.value)}
            placeholder="Project directory (leave empty to auto-create workspace)"
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim() || submitting || (planningMode === 'manual' && !codingPrompt.trim())}
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
