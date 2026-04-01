'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BUILT_IN_PRESETS } from '@/lib/prompts/presets';

interface Task {
  id: string;
  prompt: string;
  status: string;
  agentId?: string;
  projectDir?: string;
  result?: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-700 text-gray-300',
  planning: 'bg-blue-900 text-blue-300',
  plan_review: 'bg-indigo-900 text-indigo-300',
  coding: 'bg-purple-900 text-purple-300',
  verifying: 'bg-yellow-900 text-yellow-300',
  retrying: 'bg-orange-900 text-orange-300',
  completed: 'bg-green-900 text-green-300',
  failed: 'bg-red-900 text-red-300',
  escalated: 'bg-red-900 text-red-300',
};

export default function Dashboard() {
  const router = useRouter();
const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Array<{
    projectDir: string;
    taskCount: number;
    latestTask: string;
    completedCount: number;
    failedCount: number;
  }>>([]);
  const [prompt, setPrompt] = useState('');
  const [projectDir, setProjectDir] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [planningMode, setPlanningMode] = useState<'claude-cli' | 'gemini-cli' | 'api' | 'manual'>('claude-cli');
  const [codingPrompt, setCodingPrompt] = useState('');
  const [verificationChecklist, setVerificationChecklist] = useState('');
  const [agents, setAgents] = useState<Array<{ id: string; name: string; available: boolean; path: string | null }>>([]);
  const [selectedAgent, setSelectedAgent] = useState('auto');
  const [autoApprove, setAutoApprove] = useState(false);
  const [showPromptSettings, setShowPromptSettings] = useState(false);
  const [promptPreset, setPromptPreset] = useState('default');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [executionMode, setExecutionMode] = useState<'single' | 'auto-cycle'>('single');
  const [maxCycles, setMaxCycles] = useState(10);
  const [usage, setUsage] = useState<{
    totals: { costUsd: number; tokens: number; attempts: number };
    byAgent: Array<{ agentId: string; totalCost: number; totalTokens: number; attemptCount: number }>;
  } | null>(null);
  const [harnessPreview, setHarnessPreview] = useState<Array<{ role: string; source: string }> | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const dirFromUrl = urlParams.get('projectDir');
    if (dirFromUrl) setProjectDir(dirFromUrl);
  }, []);

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      setTasks(data);
    } catch {}
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(data => {
      setAgents(data.agents ?? []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/usage').then(r => r.json()).then(setUsage).catch(() => {});
  }, []);

  useEffect(() => {
    if (projectDir) {
      fetch(`/api/harness?projectDir=${encodeURIComponent(projectDir)}`)
        .then(r => r.json())
        .then(data => setHarnessPreview(data.agents?.map((a: { role: string; source: string }) => ({ role: a.role, source: a.source })) ?? null))
        .catch(() => setHarnessPreview(null));
    } else {
      setHarnessPreview(null);
    }
  }, [projectDir]);

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
        agentId: selectedAgent,
        autoApprove,
        systemPrompt: systemPrompt || undefined,
        executionMode,
        maxCycles: executionMode === 'auto-cycle' ? maxCycles : 1,
        ...(planningMode === 'manual' ? { codingPrompt, verificationChecklist } : {}),
      }),
    });
    if (res.ok) {
      const newTask = await res.json();
      setPrompt('');
      setCodingPrompt('');
      setVerificationChecklist('');
      setSubmitting(false);
      router.push(`/tasks/${newTask.id}`);
      return;
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen p-8 max-w-4xl mx-auto">
      <header className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">AutoDev Agent</h1>
          <p className="text-gray-400 mt-1">Universal AI Development Orchestrator</p>
        </div>
        <Link
          href="/harness"
          className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
        >
          ⚙ Harness
        </Link>
      </header>

      {usage && usage.totals.costUsd > 0 && (
        <div className="mb-6 flex items-center gap-6 px-4 py-3 bg-gray-900/50 rounded-lg border border-gray-800">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Total cost</p>
            <p className="text-lg font-bold text-gray-200">${usage.totals.costUsd.toFixed(4)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Total tokens</p>
            <p className="text-lg font-bold text-gray-200">{usage.totals.tokens.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Attempts</p>
            <p className="text-lg font-bold text-gray-200">{usage.totals.attempts}</p>
          </div>
          {usage.byAgent.length > 1 && (
            <div className="flex-1">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">By agent</p>
              <div className="flex gap-3">
                {usage.byAgent.map(a => (
                  <span key={a.agentId} className="text-xs text-gray-400">
                    {a.agentId}: ${a.totalCost.toFixed(4)} ({a.attemptCount})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs text-gray-500">Planning:</label>
          <div className="flex gap-1">
            {([
              { id: 'claude-cli', label: 'Claude CLI' },
              { id: 'gemini-cli', label: 'Gemini CLI' },
              { id: 'api', label: 'Claude API' },
              { id: 'manual', label: 'Manual' },
            ] as const).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setPlanningMode(mode.id)}
                className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                  planningMode === mode.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
        {planningMode === 'claude-cli' && (
          <p className="mt-1 text-xs text-gray-500">Uses Claude CLI for planning. Run &apos;claude login&apos; first.</p>
        )}
        {planningMode === 'gemini-cli' && (
          <p className="mt-1 text-xs text-gray-500">Uses Gemini CLI for planning. Faster and cheaper. Run &apos;gemini login&apos; first.</p>
        )}
        {planningMode === 'api' && (
          <p className="mt-1 text-xs text-yellow-500">Uses Claude API directly. Requires ANTHROPIC_API_KEY environment variable.</p>
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
            <option value="auto">Auto (best for task)</option>
            {agents.map(a => (
              <option key={a.id} value={a.id} disabled={!a.available}>
                {a.name} {a.available ? '' : '(not installed)'}
              </option>
            ))}
          </select>
        </div>
        {harnessPreview && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-500">Harness:</span>
            {harnessPreview.map(h => (
              <span key={h.role} className={`text-[10px] px-1.5 py-0.5 rounded ${
                h.source === 'project' ? 'bg-teal-900/30 text-teal-400' :
                h.source === 'global' ? 'bg-purple-900/30 text-purple-400' :
                'bg-gray-800 text-gray-500'
              }`}>
                {h.role}: {h.source}
              </span>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => setAutoApprove(e.target.checked)}
              className="rounded border-gray-700 bg-gray-800 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-400">Auto-approve plan (skip review)</span>
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <label className="text-xs text-gray-500">Execution:</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setExecutionMode('single')}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                executionMode === 'single'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              Single run
            </button>
            <button
              type="button"
              onClick={() => setExecutionMode('auto-cycle')}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                executionMode === 'auto-cycle'
                  ? 'bg-amber-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              Auto-cycle
            </button>
          </div>
          {executionMode === 'auto-cycle' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Max cycles:</label>
              <input
                type="number"
                min={2}
                max={50}
                value={maxCycles}
                onChange={(e) => setMaxCycles(Number(e.target.value))}
                className="w-16 px-2 py-1 text-xs bg-gray-900 border border-gray-700 rounded text-gray-300"
              />
            </div>
          )}
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowPromptSettings(!showPromptSettings)}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            {showPromptSettings ? '\u25BE' : '\u25B8'} System prompts
          </button>
          {showPromptSettings && (
            <div className="mt-2 space-y-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
              <div>
                <label className="block text-xs text-gray-500 mb-2">Preset</label>
                <div className="grid grid-cols-3 gap-2">
                  {BUILT_IN_PRESETS.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPromptPreset(p.id);
                        setSystemPrompt(p.prompt);
                      }}
                      className={`text-left p-2.5 rounded-lg transition-colors border ${
                        promptPreset === p.id
                          ? 'bg-indigo-900/30 border-indigo-700 text-indigo-200'
                          : 'bg-gray-900/50 border-gray-700/50 text-gray-400 hover:bg-gray-800 hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-sm">{p.emoji}</span>
                        <span className="text-xs font-medium">{p.name}</span>
                      </div>
                      <p className="text-[10px] leading-tight opacity-70">{p.tagline}</p>
                    </button>
                  ))}
                </div>
                {promptPreset !== 'default' && promptPreset !== 'custom' && (
                  <p className="text-xs text-gray-500 mt-2 pl-1">
                    {BUILT_IN_PRESETS.find(p => p.id === promptPreset)?.description}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  System prompt <span className="text-gray-600">(applies to both planning and coding)</span>
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => { setSystemPrompt(e.target.value); setPromptPreset('custom'); }}
                  placeholder="예: 한국어 주석 포함, TypeScript strict mode, 테스트 작성, 변수명 카멜케이스..."
                  rows={4}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-300 text-xs font-mono focus:outline-none focus:border-indigo-500 resize-y"
                />
                <p className="text-[10px] text-gray-600 mt-1">
                  This instruction is applied to both the planning phase and the coding agent.
                  Write freely — no need to separate planning vs coding instructions.
                </p>
              </div>
            </div>
          )}
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
            type="button"
            onClick={async () => {
              try {
                const res = await fetch('/api/workspace/browse', { method: 'POST' });
                if (res.ok) {
                  const data = await res.json();
                  if (data.path) setProjectDir(data.path);
                }
              } catch {}
            }}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors text-sm whitespace-nowrap"
          >
            Browse
          </button>
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim() || submitting || (planningMode === 'manual' && !codingPrompt.trim())}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
          >
            {submitting ? 'Submitting...' : 'Run'}
          </button>
        </div>
      </section>

      {projects.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Recent Projects</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {projects.slice(0, 6).map((project) => (
              <div
                key={project.projectDir}
                className={`text-left p-4 bg-gray-900 rounded-lg border transition-colors ${
                  projectDir === project.projectDir
                    ? 'border-indigo-600'
                    : 'border-gray-800 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setProjectDir(project.projectDir)}
                    className="flex-1 text-left min-w-0"
                  >
                    <p className="text-sm text-gray-200 truncate font-mono">
                      {project.projectDir.split('/').slice(-2).join('/')}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
                      <span>{project.taskCount} tasks</span>
                      <span className="text-green-500">{project.completedCount} ✓</span>
                      {project.failedCount > 0 && <span className="text-red-500">{project.failedCount} ✗</span>}
                      <span>· {new Date(project.latestTask).toLocaleDateString()}</span>
                    </div>
                  </button>
                  <Link
                    href={`/projects/${encodeURIComponent(btoa(project.projectDir))}`}
                    className="ml-2 px-2 py-1 text-xs text-gray-500 hover:text-indigo-400 hover:bg-gray-800 rounded transition-colors"
                    title="Project details"
                  >
                    →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-4">Tasks</h2>
        {tasks.length === 0 ? (
          <p className="text-gray-500">No tasks yet. Create one above.</p>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => {
              const result = task.result ? (typeof task.result === 'string' ? (() => { try { return JSON.parse(task.result); } catch { return null; } })() : task.result) : null;
              const duration = task.updatedAt && task.createdAt
                ? Math.round((new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime()) / 1000)
                : null;

              return (
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
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                    <span>{new Date(task.createdAt).toLocaleString()}</span>
                    {task.agentId && <span>· {task.agentId}</span>}
                    {duration !== null && duration > 0 && <span>· {duration}s</span>}
                    {result?.costUsd && <span>· ${Number(result.costUsd).toFixed(4)}</span>}
                    {result?.modifiedFiles?.length > 0 && <span>· {result.modifiedFiles.length} files</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
