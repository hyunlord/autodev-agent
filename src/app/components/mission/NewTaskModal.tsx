'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BUILT_IN_PRESETS } from '@/lib/prompts/presets';
import Tooltip from '../Tooltip';
import { TOOLTIPS } from '../tooltips';

interface NewTaskModalProps {
  onClose: () => void;
  onCreated: () => void;
  initialProjectDir?: string;
  chainTask?: { id: string; prompt: string } | null;
}

export default function NewTaskModal({ onClose, onCreated, initialProjectDir, chainTask: initialChain }: NewTaskModalProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [projectDir, setProjectDir] = useState(initialProjectDir ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [planningMode, setPlanningMode] = useState<'claude-cli' | 'gemini-cli' | 'codex-cli' | 'api' | 'manual' | 'debate'>('claude-cli');
  const [debateDrafterMode, setDebateDrafterMode] = useState<'claude-cli' | 'gemini-cli' | 'codex-cli' | 'api'>('claude-cli');
  const [codingPrompt, setCodingPrompt] = useState('');
  const [verificationChecklist, setVerificationChecklist] = useState('');
  const [agents, setAgents] = useState<Array<{ id: string; name: string; available: boolean; path: string | null }>>([]);
  const [selectedAgent, setSelectedAgent] = useState('auto');
  const [autoApprove, setAutoApprove] = useState(false);
  const [showPromptSettings, setShowPromptSettings] = useState(false);
  const [promptPreset, setPromptPreset] = useState('default');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [executionMode, setExecutionMode] = useState<'single' | 'auto-cycle' | 'interview' | 'arena'>('single');
  const [maxCycles, setMaxCycles] = useState(10);
  const [costPref, setCostPref] = useState<'cheap' | 'balanced' | 'quality'>('balanced');
  const [harnessPreview, setHarnessPreview] = useState<Array<{ role: string; source: string }> | null>(null);
  const [chainTask, setChainTask] = useState(initialChain ?? null);
  const [isNewProject, setIsNewProject] = useState(false);

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(data => {
      setAgents(data.agents ?? []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (projectDir) {
      fetch(`/api/harness?projectDir=${encodeURIComponent(projectDir)}`)
        .then(r => r.json())
        .then(data => setHarnessPreview(data.agents?.map((a: { role: string; source: string }) => ({ role: a.role, source: a.source })) ?? null))
        .catch(() => setHarnessPreview(null));
      fetch(`/api/projects/check?dir=${encodeURIComponent(projectDir)}`)
        .then(r => r.json())
        .then(d => setIsNewProject(!d.hasConfig))
        .catch(() => setIsNewProject(false));
    } else {
      setHarnessPreview(null);
      setIsNewProject(false);
    }
  }, [projectDir]);

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          projectDir: projectDir || undefined,
          planningMode,
          agentId: selectedAgent,
          autoApprove,
          costPreference: costPref,
          systemPrompt: systemPrompt || undefined,
          executionMode,
          maxCycles: executionMode === 'auto-cycle' ? maxCycles : 1,
          ...(planningMode === 'manual' ? { codingPrompt, verificationChecklist } : {}),
          ...(planningMode === 'debate' ? { config: { debateDrafterMode } } : {}),
          ...(chainTask ? { parentTaskId: chainTask.id } : {}),
        }),
      });
      if (res.ok) {
        const newTask = await res.json();
        onCreated();
        router.push(`/tasks/${newTask.id}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create new task"
        className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-gray-900 rounded-xl border border-gray-700 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">New Task</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
        </div>

        {/* Chain task indicator */}
        {chainTask && (
          <div className="mb-4 px-3 py-2.5 bg-indigo-950/40 border border-indigo-800/60 rounded-lg flex items-center justify-between">
            <div className="text-xs text-indigo-300">
              <span className="font-medium">Chain from:</span>{' '}
              <span className="text-gray-400">{chainTask.prompt.slice(0, 80)}{chainTask.prompt.length > 80 ? '...' : ''}</span>
            </div>
            <button onClick={() => setChainTask(null)} className="ml-2 text-gray-600 hover:text-gray-400 text-xs">
              &times;
            </button>
          </div>
        )}

        {/* Prompt */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what you want to build or change..."
          rows={3}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
          autoFocus
        />

        {/* Guide text */}
        <div className="mt-3 p-2.5 rounded-lg bg-gray-800/50">
          <p className="text-[10px] text-gray-500">
            작업을 설명하면 AI가 자동으로 계획 → 코딩 → 검증합니다.
            각 옵션에 마우스를 올리면 상세 설명이 표시됩니다.
          </p>
        </div>

        {/* Planning mode */}
        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs text-gray-500 flex items-center gap-1">
            Planning:
            <Tooltip text="AI가 구현 계획을 세우는 방식을 선택합니다. 각 모드마다 속도, 비용, 품질이 다릅니다." position="bottom" />
          </label>
          <div className="flex gap-1 flex-wrap">
            {([
              { id: 'claude-cli', label: 'Claude CLI' },
              { id: 'gemini-cli', label: 'Gemini CLI' },
              { id: 'codex-cli', label: 'Codex CLI' },
              { id: 'api', label: 'Claude API' },
              { id: 'debate', label: 'Debate' },
              { id: 'manual', label: 'Manual' },
            ] as const).map((mode) => (
              <Tooltip key={mode.id} text={TOOLTIPS.planningMode[mode.id] ?? ''} position="bottom">
                <button
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
              </Tooltip>
            ))}
          </div>
        </div>

        {/* Debate drafter */}
        {planningMode === 'debate' && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-purple-400">Drafter &rarr; Challenger &rarr; QC</p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Drafter:</label>
              <div className="flex gap-1">
                {([
                  { id: 'claude-cli', label: 'Claude CLI' },
                  { id: 'gemini-cli', label: 'Gemini CLI' },
                  { id: 'codex-cli', label: 'Codex CLI' },
                  { id: 'api', label: 'Claude API' },
                ] as const).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setDebateDrafterMode(mode.id)}
                    className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                      debateDrafterMode === mode.id
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Manual mode fields */}
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

        {/* Agent selector */}
        <div className="mt-3">
          <label className="text-sm text-gray-400 mb-1 flex items-center gap-1">
            Coding Agent
            <Tooltip text="코드를 생성할 AI 에이전트를 선택합니다. Auto는 비용 설정에 따라 자동 선택." position="bottom" />
          </label>
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

        {/* Harness preview */}
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

        {/* New project notice */}
        {isNewProject && projectDir && (
          <div className="mt-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
            <p className="text-xs text-amber-400">
              New project detected — default harness settings will be created in <code className="bg-amber-900/30 px-1 rounded">.autodev/</code>
            </p>
          </div>
        )}

        {/* Auto-approve */}
        <div className="mt-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => setAutoApprove(e.target.checked)}
              className="rounded border-gray-700 bg-gray-800 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-400">Auto-approve plan (skip review)</span>
            <Tooltip text={TOOLTIPS.autoApprove} position="bottom" />
          </label>
          {autoApprove && (
            <p className="text-[10px] text-amber-500 mt-1 ml-5">
              Plan review will be skipped
            </p>
          )}
        </div>

        {/* Cost preference */}
        <div className="mt-3 flex items-center gap-3">
          <label className="text-xs text-gray-500 flex items-center gap-1">
            Cost:
            <Tooltip text="에이전트 자동 선택 시 비용 vs 품질 우선순위를 결정합니다." position="bottom" />
          </label>
          <div className="flex gap-1">
            {([
              { id: 'cheap' as const, label: 'Budget' },
              { id: 'balanced' as const, label: 'Balanced' },
              { id: 'quality' as const, label: 'Quality' },
            ]).map((pref) => (
              <Tooltip key={pref.id} text={TOOLTIPS.costPreference[pref.id] ?? ''} position="bottom">
                <button
                  type="button"
                  onClick={() => setCostPref(pref.id)}
                  className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                    costPref === pref.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {pref.label}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* Execution mode */}
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <label className="text-xs text-gray-500 flex items-center gap-1">
            Execution:
            <Tooltip text="작업 실행 방식을 선택합니다. Single은 한 번, Auto-cycle은 자동 재시도." position="bottom" />
          </label>
          <div className="flex gap-2">
            {([
              { id: 'single' as const, label: 'Single run', color: 'indigo' },
              { id: 'auto-cycle' as const, label: 'Auto-cycle', color: 'amber' },
              { id: 'interview' as const, label: 'Interview', color: 'teal' },
              { id: 'arena' as const, label: 'Arena', color: 'rose' },
            ]).map(mode => (
              <Tooltip key={mode.id} text={TOOLTIPS.executionMode[mode.id] ?? ''} position="bottom">
                <button type="button" onClick={() => setExecutionMode(mode.id)}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${executionMode === mode.id ? `bg-${mode.color}-600 text-white` : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                  {mode.label}
                </button>
              </Tooltip>
            ))}
          </div>
          {executionMode === 'auto-cycle' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Max cycles:</label>
              <input type="number" min={2} max={50} value={maxCycles}
                onChange={(e) => setMaxCycles(Number(e.target.value))}
                className="w-16 px-2 py-1 text-xs bg-gray-900 border border-gray-700 rounded text-gray-300" />
            </div>
          )}
        </div>

        {/* System prompts */}
        <div className="mt-3">
          <button type="button" onClick={() => setShowPromptSettings(!showPromptSettings)}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
            {showPromptSettings ? '\u25BE' : '\u25B8'} System prompts
          </button>
          {showPromptSettings && (
            <div className="mt-2 space-y-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
              <div>
                <label className="block text-xs text-gray-500 mb-2">Preset</label>
                <div className="grid grid-cols-3 gap-2">
                  {BUILT_IN_PRESETS.map(p => (
                    <button key={p.id} type="button"
                      onClick={() => { setPromptPreset(p.id); setSystemPrompt(p.prompt); }}
                      className={`text-left p-2.5 rounded-lg transition-colors border ${
                        promptPreset === p.id
                          ? 'bg-indigo-900/30 border-indigo-700 text-indigo-200'
                          : 'bg-gray-900/50 border-gray-700/50 text-gray-400 hover:bg-gray-800 hover:border-gray-600'
                      }`}>
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
                <textarea value={systemPrompt}
                  onChange={(e) => { setSystemPrompt(e.target.value); setPromptPreset('custom'); }}
                  placeholder="Custom system prompt..."
                  rows={4}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-300 text-xs font-mono focus:outline-none focus:border-indigo-500 resize-y" />
              </div>
            </div>
          )}
        </div>

        {/* Project dir + submit */}
        <div className="mt-4 flex gap-3">
          <input type="text" value={projectDir}
            onChange={(e) => setProjectDir(e.target.value)}
            placeholder="Project directory (leave empty to auto-create workspace)"
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
          <button type="button"
            onClick={async () => {
              try {
                const res = await fetch('/api/workspace/browse', { method: 'POST' });
                if (res.ok) {
                  const data = await res.json();
                  if (data.path) setProjectDir(data.path);
                }
              } catch { /* ignore */ }
            }}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors text-sm whitespace-nowrap">
            Browse
          </button>
          <button onClick={handleSubmit}
            disabled={!prompt.trim() || submitting || (planningMode === 'manual' && !codingPrompt.trim())}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-medium transition-colors">
            {submitting ? 'Running...' : 'Run'}
          </button>
        </div>
      </div>
    </div>
  );
}
