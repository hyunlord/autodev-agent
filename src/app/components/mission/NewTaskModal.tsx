'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BUILT_IN_PRESETS } from '@/lib/prompts/presets';
import Tooltip from '../Tooltip';
import { TOOLTIPS } from '../tooltips';
import { useTranslations, useLocale } from '@/i18n/context';

interface NewTaskModalProps {
  onClose: () => void;
  onCreated: () => void;
  initialProjectDir?: string;
  chainTask?: { id: string; prompt: string } | null;
}

export default function NewTaskModal({ onClose, onCreated, initialProjectDir, chainTask: initialChain }: NewTaskModalProps) {
  const router = useRouter();
  const t = useTranslations('newTask');
  const { locale } = useLocale();
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
          locale,
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
        className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl border shadow-2xl p-6"
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <button onClick={onClose} className="text-lg leading-none hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>&times;</button>
        </div>

        {/* Chain task indicator */}
        {chainTask && (
          <div className="mb-4 px-3 py-2.5 bg-indigo-950/40 border border-indigo-800/60 rounded-lg flex items-center justify-between">
            <div className="text-xs text-indigo-300">
              <span className="font-medium">{t('chainFrom')}</span>{' '}
              <span style={{ color: 'var(--text-secondary)' }}>{chainTask.prompt.slice(0, 80)}{chainTask.prompt.length > 80 ? '...' : ''}</span>
            </div>
            <button onClick={() => setChainTask(null)} className="ml-2 hover:text-gray-400 text-xs" style={{ color: 'var(--text-secondary)' }}>
              &times;
            </button>
          </div>
        )}

        {/* Prompt */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('promptPlaceholder')}
          rows={3}
          className="w-full px-4 py-3 border rounded-lg placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
          autoFocus
        />

        {/* Guide text */}
        <div className="mt-3 p-2.5 rounded-lg" style={{ background: 'var(--bg-card)' }}>
          <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            {t('guide')}
          </p>
        </div>

        {/* Planning mode */}
        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            {t('planning')}:
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
                      : 'hover:opacity-80'
                  }`}
                  style={planningMode !== mode.id ? { background: 'var(--bg-card)', color: 'var(--text-secondary)' } : undefined}
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
              <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>Drafter:</label>
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
                        : 'hover:opacity-80'
                    }`}
                    style={debateDrafterMode !== mode.id ? { background: 'var(--bg-card)', color: 'var(--text-secondary)' } : undefined}
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
              <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>{t('codingPromptLabel')}</label>
              <textarea
                value={codingPrompt}
                onChange={(e) => setCodingPrompt(e.target.value)}
                placeholder={t('codingPromptPlaceholder')}
                rows={4}
                className="w-full px-4 py-3 border rounded-lg placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
              />
            </div>
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>{t('verificationChecklist')}</label>
              <textarea
                value={verificationChecklist}
                onChange={(e) => setVerificationChecklist(e.target.value)}
                placeholder={"1. Button visible on page\n2. Click toggles state\n3. Persists after refresh"}
                rows={3}
                className="w-full px-4 py-3 border rounded-lg placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
              />
            </div>
          </div>
        )}

        {/* Agent selector */}
        <div className="mt-3">
          <label className="text-sm mb-1 flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            {t('agent')}
            <Tooltip text="코드를 생성할 AI 에이전트를 선택합니다. Auto는 비용 설정에 따라 자동 선택." position="bottom" />
          </label>
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:border-indigo-500"
            style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
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
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Harness:</span>
            {harnessPreview.map(h => (
              <span key={h.role} className={`text-[10px] px-1.5 py-0.5 rounded ${
                h.source === 'project' ? 'bg-teal-900/30 text-teal-400' :
                h.source === 'global' ? 'bg-purple-900/30 text-purple-400' :
                ''
              }`} style={h.source !== 'project' && h.source !== 'global' ? { background: 'var(--bg-card)', color: 'var(--text-secondary)' } : undefined}>
                {h.role}: {h.source}
              </span>
            ))}
          </div>
        )}

        {/* New project notice */}
        {isNewProject && projectDir && (
          <div className="mt-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
            <p className="text-xs text-amber-400">
              {t('newProject')}
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
              className="rounded text-indigo-600 focus:ring-indigo-500"
              style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}
            />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('autoApprove')}</span>
            <Tooltip text={TOOLTIPS.autoApprove} position="bottom" />
          </label>
          {autoApprove && (
            <p className="text-[10px] text-amber-500 mt-1 ml-5">
              {t('autoApproveDesc')}
            </p>
          )}
        </div>

        {/* Cost preference */}
        <div className="mt-3 flex items-center gap-3">
          <label className="text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            {t('cost')}:
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
                      : 'hover:opacity-80'
                  }`}
                  style={costPref !== pref.id ? { background: 'var(--bg-card)', color: 'var(--text-secondary)' } : undefined}
                >
                  {pref.label}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* Execution mode */}
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <label className="text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            {t('mode')}:
            <Tooltip text="작업 실행 방식을 선택합니다. Single은 한 번, Auto-cycle은 자동 재시도." position="bottom" />
          </label>
          <div className="flex gap-2">
            {([
              { id: 'single' as const, label: 'Single run', active: 'bg-indigo-600 text-white' },
              { id: 'auto-cycle' as const, label: 'Auto-cycle', active: 'bg-amber-600 text-white' },
              { id: 'interview' as const, label: 'Interview', active: 'bg-teal-600 text-white' },
              { id: 'arena' as const, label: 'Arena', active: 'bg-rose-600 text-white' },
            ]).map(mode => (
              <Tooltip key={mode.id} text={TOOLTIPS.executionMode[mode.id] ?? ''} position="bottom">
                <button type="button" onClick={() => setExecutionMode(mode.id)}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${executionMode === mode.id ? mode.active : 'hover:opacity-80'}`}
                  style={executionMode !== mode.id ? { background: 'var(--bg-card)', color: 'var(--text-secondary)' } : undefined}>
                  {mode.label}
                </button>
              </Tooltip>
            ))}
          </div>
          {executionMode === 'auto-cycle' && (
            <div className="flex items-center gap-2">
              <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('maxCycles')}</label>
              <input type="number" min={2} max={50} value={maxCycles}
                onChange={(e) => setMaxCycles(Number(e.target.value))}
                className="w-16 px-2 py-1 text-xs border rounded"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }} />
            </div>
          )}
        </div>

        {/* System prompts */}
        <div className="mt-3">
          <button type="button" onClick={() => setShowPromptSettings(!showPromptSettings)}
            className="text-sm hover:opacity-80 transition-colors" style={{ color: 'var(--text-secondary)' }}>
            {showPromptSettings ? '\u25BE' : '\u25B8'} {t('systemPrompts')}
          </button>
          {showPromptSettings && (
            <div className="mt-2 space-y-3 p-3 rounded-lg border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
              <div>
                <label className="block text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>{t('preset')}</label>
                <div className="grid grid-cols-3 gap-2">
                  {BUILT_IN_PRESETS.map(p => (
                    <button key={p.id} type="button"
                      onClick={() => { setPromptPreset(p.id); setSystemPrompt(p.prompt); }}
                      className={`text-left p-2.5 rounded-lg transition-colors border ${
                        promptPreset === p.id
                          ? 'bg-indigo-900/30 border-indigo-700 text-indigo-200'
                          : 'hover:opacity-80'
                      }`}
                      style={promptPreset !== p.id ? { background: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' } : undefined}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-sm">{p.emoji}</span>
                        <span className="text-xs font-medium">{p.name}</span>
                      </div>
                      <p className="text-[10px] leading-tight opacity-70">{p.tagline}</p>
                    </button>
                  ))}
                </div>
                {promptPreset !== 'default' && promptPreset !== 'custom' && (
                  <p className="text-xs mt-2 pl-1" style={{ color: 'var(--text-secondary)' }}>
                    {BUILT_IN_PRESETS.find(p => p.id === promptPreset)?.description}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                  {t('systemPromptLabel')} <span style={{ color: 'var(--text-secondary)' }}>{t('systemPromptSub')}</span>
                </label>
                <textarea value={systemPrompt}
                  onChange={(e) => { setSystemPrompt(e.target.value); setPromptPreset('custom'); }}
                  placeholder={t('customPlaceholder')}
                  rows={4}
                  className="w-full px-3 py-2 border rounded-lg text-xs font-mono focus:outline-none focus:border-indigo-500 resize-y"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }} />
              </div>
            </div>
          )}
        </div>

        {/* Project dir + submit */}
        <div className="mt-4 flex gap-3">
          <input type="text" value={projectDir}
            onChange={(e) => setProjectDir(e.target.value)}
            placeholder={t('projectDirPlaceholder')}
            className="flex-1 px-3 py-2 border rounded-lg placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }} />
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
            className="px-3 py-2 rounded-lg transition-colors text-sm whitespace-nowrap hover:opacity-80"
            style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
            {t('browse')}
          </button>
          <button onClick={handleSubmit}
            disabled={!prompt.trim() || submitting || (planningMode === 'manual' && !codingPrompt.trim())}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-medium transition-colors">
            {submitting ? t('running') : t('run')}
          </button>
        </div>
      </div>
    </div>
  );
}
