'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Tooltip from '../components/Tooltip';
import { TOOLTIPS } from '../components/tooltips';
import { useTranslations } from '@/i18n/context';
import EvolveModal from '../components/EvolveModal';

// 예약된 에이전트 역할 — 아직 파이프라인에 통합되지 않아 Evolve 불가.
// 통합 시 Set에서 제거하면 자동 활성화. evolve/route.ts의 RESERVED_ROLES와 동기화 필요.
const RESERVED_EVOLVE_ROLES = new Set(['evaluator']);

// --- AI Edit Bar for Agent Prompts ---
function AiEditBar({ editContent, editingRole, onApply }: {
  editContent: string;
  editingRole: string;
  onApply: (newContent: string) => void;
}) {
  const t = useTranslations('harness');
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAiEdit = async () => {
    if (!instruction.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/harness/ai-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPrompt: editContent, instruction, role: editingRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '수정 실패');
        setLoading(false);
        return;
      }
      if (data.editedPrompt) {
        onApply(data.editedPrompt);
        setInstruction('');
      }
    } catch {
      setError('네트워크 오류 — 다시 시도해주세요');
    }
    setLoading(false);
  };

  return (
    <div className="px-4 py-2.5 border-t" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{t('aiEdit')}:</span>
        <input
          value={instruction}
          onChange={e => { setInstruction(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiEdit(); } }}
          placeholder={t('aiEditPlaceholder')}
          className="flex-1 px-3 py-1.5 text-xs border rounded-lg placeholder-gray-600 outline-none focus:border-indigo-500"
          style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
        />
        <button
          onClick={handleAiEdit}
          disabled={!instruction.trim() || loading}
          className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-40 transition-colors whitespace-nowrap"
        >
          {loading ? t('editing') : t('apply')}
        </button>
      </div>
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}

// --- Pipeline Config Types ---
interface VerificationStageConfig {
  mechanical: boolean;    // Stage 1: always ON
  browser: boolean;       // Stage 2
  vlm: boolean;           // Stage 2.5
  vlmRuns: number;        // 1-3
  acceptance: boolean;    // Stage 2.8
  sast: boolean;          // Stage 2.9a
  a11y: boolean;          // Stage 2.9b
  llmReview: boolean;     // Stage 3: always ON
  propertyTest: boolean;  // Stage 3.5
  debate: boolean;        // Debate Verification
}

interface PipelineConfig {
  planningMode: 'normal' | 'debate' | 'manual';
  codingMode: 'single' | 'parallel' | 'arena';
  verification: VerificationStageConfig;
}

const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  planningMode: 'normal',
  codingMode: 'single',
  verification: {
    mechanical: true,
    browser: true,
    vlm: false,
    vlmRuns: 1,
    acceptance: true,
    sast: false,
    a11y: false,
    llmReview: true,
    propertyTest: false,
    debate: false,
  },
};

const VERIFICATION_STAGES = [
  { key: 'mechanical', label: 'Stage 1: Mechanical Checks', desc: '빌드, 파일 존재, TypeScript 에러', locked: true },
  { key: 'browser', label: 'Stage 2: Browser Testing', desc: 'Playwright 스크린샷 + DOM 검증', locked: false },
  { key: 'vlm', label: 'Stage 2.5: VLM Visual Analysis', desc: '디자인 채점 (runs: 1-3)', locked: false, hasRuns: true },
  { key: 'acceptance', label: 'Stage 2.8: Acceptance Criteria', desc: 'Plan의 검증 스펙 체크', locked: false },
  { key: 'sast', label: 'Stage 2.9a: SAST Security Scan', desc: 'Semgrep 정적 보안 분석', locked: false },
  { key: 'a11y', label: 'Stage 2.9b: A11y Accessibility', desc: 'axe-core WCAG 접근성 검사', locked: false },
  { key: 'llmReview', label: 'Stage 3: LLM Code Review', desc: 'Cross-model 코드 리뷰', locked: true },
  { key: 'propertyTest', label: 'Stage 3.5: Property-Based Testing', desc: 'fast-check 속성 테스트', locked: false },
  { key: 'debate', label: 'Debate Verification', desc: 'Primary + Challenger 검증', locked: false },
] as { key: string; label: string; desc: string; locked: boolean; hasRuns?: boolean }[];

const PLANNING_MODES = [
  { value: 'normal', label: 'Normal Mode', desc: '단일 LLM이 계획 생성' },
  { value: 'debate', label: 'Debate Mode', desc: 'Drafter → Challenger → QC 3단계' },
  { value: 'manual', label: 'Manual Mode', desc: '사용자가 직접 Plan 작성' },
] as const;

const CODING_MODES = [
  { value: 'single', label: 'Single Agent', desc: '단일 에이전트가 순차 실행' },
  { value: 'parallel', label: 'Parallel Sub-tasks (DAG)', desc: 'Plan의 sub-tasks를 병렬 실행' },
  { value: 'arena', label: 'Arena Mode', desc: '여러 에이전트가 경쟁, 최고 결과 선택' },
] as const;

const PIPELINE_STAGES = [
  {
    id: 'detect',
    emoji: '🔍',
    name: 'Project Detection',
    description: '프로젝트 타입 감지 (static-html, nextjs, react 등)',
    agentFile: null as string | null,
    mcpTools: [] as string[],
    skippable: false,
    skipCondition: null as string | null,
    onFail: null as string | null,
    nextLabel: '',
    expandable: false,
  },
  {
    id: 'plan',
    emoji: '📋',
    name: 'Planning',
    description: 'LLM이 구현 계획 생성 (codingPrompt + verificationSpec)',
    agentFile: 'planner.md',
    mcpTools: ['context7', 'websearch'],
    skippable: false,
    skipCondition: null,
    onFail: 'task failed',
    nextLabel: '',
    expandable: true,
  },
  {
    id: 'review',
    emoji: '👀',
    name: 'Plan Review',
    description: '사용자가 계획을 승인/수정/거절',
    agentFile: null,
    mcpTools: [],
    skippable: true,
    skipCondition: 'auto-approve 활성화 시',
    onFail: 'task rejected',
    nextLabel: 'approved',
    expandable: false,
  },
  {
    id: 'select',
    emoji: '🤖',
    name: 'Agent Selection',
    description: 'LLM 추천 또는 사용자 선택으로 최적 코딩 에이전트 결정',
    agentFile: null,
    mcpTools: [],
    skippable: false,
    skipCondition: null,
    onFail: null,
    nextLabel: '',
    expandable: false,
  },
  {
    id: 'code',
    emoji: '💻',
    name: 'Coding',
    description: '선택된 에이전트가 코드 생성/수정',
    agentFile: 'coder.md',
    mcpTools: ['codex'],
    skippable: false,
    skipCondition: null,
    onFail: 'retry',
    nextLabel: '',
    expandable: true,
  },
  {
    id: 'verify',
    emoji: '✅',
    name: 'Verification',
    description: '파일 체크, 빌드, HTTP, DOM 등 8가지 검증',
    agentFile: 'verifier.md',
    mcpTools: ['playwright'],
    skippable: false,
    skipCondition: null,
    onFail: 'retry → escalation',
    nextLabel: '',
    expandable: true,
  },
  {
    id: 'complete',
    emoji: '🎉',
    name: 'Complete',
    description: '검증 통과 → 작업 완료',
    agentFile: 'evaluator.md',
    mcpTools: [],
    skippable: false,
    skipCondition: null,
    onFail: null,
    nextLabel: '',
    expandable: false,
  },
];

interface AgentFile {
  role: string;
  content: string;
  source: 'project' | 'global' | 'default';
  filePath?: string;
}

interface McpServer {
  id: string;
  type: string;
  enabled: boolean;
  url?: string;
  command?: string;
  args?: string[];
  stages: string[];
}

interface Project {
  projectDir: string;
  taskCount: number;
}

function AgentsTab({ agents, sourceColor, onEdit, onReset, onEvolve }: {
  agents: AgentFile[];
  sourceColor: (s: string) => string;
  onEdit: (role: string, content: string) => void;
  onReset: (role: string) => void;
  onEvolve: (role: string) => void;
}) {
  const t = useTranslations('harness');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (role: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(role) ? next.delete(role) : next.add(role);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {agents.map(agent => {
        const isExpanded = expanded.has(agent.role);
        const lineCount = agent.content.split('\n').length;
        return (
          <div key={agent.role} className="border rounded-xl p-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold">{agent.role}.md</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${sourceColor(agent.source)}`}>
                  {agent.source}
                </span>
              </div>
              <div className="flex gap-2">
                {RESERVED_EVOLVE_ROLES.has(agent.role) ? (
                  <button
                    disabled
                    title={t('evolveReservedTooltip')}
                    className="px-3 py-1 text-xs border border-gray-600 text-gray-500 rounded-lg opacity-40 cursor-not-allowed"
                  >
                    🧬 Evolve (reserved)
                  </button>
                ) : (
                  <button
                    onClick={() => onEvolve(agent.role)}
                    className="px-3 py-1 text-xs border border-indigo-600 text-indigo-400 hover:bg-indigo-600 hover:text-white rounded-lg transition-colors"
                  >
                    🧬 Evolve
                  </button>
                )}
                <button
                  onClick={() => onEdit(agent.role, agent.content)}
                  className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                >
                  Edit
                </button>
                {agent.source !== 'default' && (
                  <button
                    onClick={() => onReset(agent.role)}
                    className="px-3 py-1 text-xs text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
            <pre className={`text-xs whitespace-pre-wrap rounded-lg p-3 overflow-y-auto ${
              isExpanded ? 'max-h-[600px]' : 'max-h-36'
            }`} style={{ color: 'var(--text-secondary)', background: 'var(--bg-primary)' }}>
              {agent.content}
            </pre>
            {lineCount > 8 && (
              <button
                onClick={() => toggle(agent.role)}
                className="text-indigo-400 hover:text-indigo-300 text-xs mt-1.5"
              >
                {isExpanded ? '접기 ▲' : '더보기 ▼'}
              </button>
            )}
            {agent.filePath && (
              <p className="text-[10px] mt-2" style={{ color: 'var(--text-secondary)' }}>{agent.filePath}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function HarnessPage() {
  const t = useTranslations('harness');
  const [tab, setTab] = useState<'pipeline' | 'agents' | 'mcp' | 'presets'>('pipeline');
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentFile[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [pipelineConfig, setPipelineConfig] = useState<PipelineConfig>(DEFAULT_PIPELINE_CONFIG);
  const [configDirty, setConfigDirty] = useState(false);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [evolveRole, setEvolveRole] = useState<string | null>(null);

  // Harness Command state
  const [harnessCommand, setHarnessCommand] = useState('');
  const [commandCli, setCommandCli] = useState<'claude-cli' | 'gemini-cli' | 'codex-cli' | 'api'>('claude-cli');
  const [commandLoading, setCommandLoading] = useState(false);
  const [commandResult, setCommandResult] = useState<{ summary: string; changes: string[]; cliMode?: string; durationMs?: number } | null>(null);
  const [harnessLog, setHarnessLog] = useState<Array<{ timestamp: string; action: string; command?: string; summary?: string; file?: string; cliMode?: string }>>([]);

  // Scope selector
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedScope, setSelectedScope] = useState<string>('global'); // 'global' or projectDir

  // Load project list
  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(setProjects).catch(() => {});
  }, []);

  // Load agents based on scope
  useEffect(() => {
    const params = selectedScope !== 'global'
      ? `?projectDir=${encodeURIComponent(selectedScope)}`
      : '';
    fetch(`/api/harness${params}`)
      .then(r => r.json())
      .then(data => {
        setAgents(data.agents ?? []);
        if (data.pipelineConfig && Object.keys(data.pipelineConfig).length > 0) {
          setPipelineConfig(prev => ({ ...prev, ...data.pipelineConfig, verification: { ...prev.verification, ...(data.pipelineConfig.verification ?? {}) } }));
        }
      })
      .catch(() => {});
  }, [selectedScope]);

  useEffect(() => {
    if (tab === 'pipeline') {
      const params = selectedScope !== 'global' ? `?projectDir=${encodeURIComponent(selectedScope)}` : '';
      fetch(`/api/harness/log${params}`)
        .then(r => r.json())
        .then(setHarnessLog)
        .catch(() => setHarnessLog([]));
    }
  }, [tab, selectedScope, commandResult]);

  useEffect(() => {
    fetch('/api/mcp')
      .then(r => r.json())
      .then(data => setMcpServers(data.servers ?? []))
      .catch(() => {});
  }, []);

  const handleEdit = (role: string, content: string) => {
    setEditingRole(role);
    setEditContent(content);
  };

  const handleSave = async () => {
    if (!editingRole) return;
    setSaving(true);
    try {
      const isProject = selectedScope !== 'global';
      const res = await fetch('/api/harness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'agent',
          role: editingRole,
          content: editContent,
          scope: isProject ? 'project' : 'global',
          projectDir: isProject ? selectedScope : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`Saved ${editingRole}.md → ${data.scope} (${data.filePath})`);
        setAgents(prev => prev.map(a =>
          a.role === editingRole ? { ...a, content: editContent, source: data.scope, filePath: data.filePath } : a
        ));
        setEditingRole(null);
      }
    } catch {
      setMessage('Save failed');
    }
    setSaving(false);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleReset = async (role: string) => {
    if (!confirm(`Reset ${role}.md to default? Your customizations will be deleted.`)) return;
    const isProject = selectedScope !== 'global';
    const params = new URLSearchParams({ role, scope: isProject ? 'project' : 'global' });
    if (isProject) params.set('projectDir', selectedScope);
    await fetch(`/api/harness?${params}`, { method: 'DELETE' });
    // Reload
    const fetchParams = isProject ? `?projectDir=${encodeURIComponent(selectedScope)}` : '';
    const res = await fetch(`/api/harness${fetchParams}`);
    const data = await res.json();
    setAgents(data.agents ?? []);
    setMessage(`${role}.md reset to default`);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleHarnessCommand = async () => {
    if (!harnessCommand.trim()) return;
    setCommandLoading(true);
    setCommandResult(null);
    try {
      const res = await fetch('/api/harness/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: harnessCommand,
          cliMode: commandCli,
          projectDir: selectedScope !== 'global' ? selectedScope : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCommandResult({ summary: data.summary, changes: data.changes });
        setHarnessCommand('');
        const params = selectedScope !== 'global'
          ? `?projectDir=${encodeURIComponent(selectedScope)}`
          : '';
        fetch(`/api/harness${params}`)
          .then(r => r.json())
          .then(d => setAgents(d.agents ?? []))
          .catch(() => {});
      } else {
        setCommandResult({ summary: `Error: ${data.error}`, changes: [] });
      }
    } catch {
      setCommandResult({ summary: 'Request failed', changes: [] });
    }
    setCommandLoading(false);
  };

  const savePipelineConfig = useCallback(async (config: PipelineConfig) => {
    const isProject = selectedScope !== 'global';
    await fetch('/api/harness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'pipeline-config',
        content: config,
        scope: isProject ? 'project' : 'global',
        projectDir: isProject ? selectedScope : undefined,
      }),
    });
    setConfigDirty(false);
    setMessage('Pipeline config saved');
    setTimeout(() => setMessage(''), 2000);
  }, [selectedScope]);

  const updateConfig = useCallback((updater: (prev: PipelineConfig) => PipelineConfig) => {
    setPipelineConfig(prev => {
      const next = updater(prev);
      setConfigDirty(true);
      return next;
    });
  }, []);

  const toggleVerification = useCallback((key: string) => {
    updateConfig(prev => ({
      ...prev,
      verification: { ...prev.verification, [key]: !prev.verification[key as keyof VerificationStageConfig] },
    }));
  }, [updateConfig]);

  const sourceColor = (source: string) => {
    if (source === 'project') return 'text-teal-400 bg-teal-900/30';
    if (source === 'global') return 'text-purple-400 bg-purple-900/30';
    return 'opacity-70';
  };

  return (
    <div className="min-h-screen p-8 max-w-5xl mx-auto bg-[var(--bg-primary)]">
      <Link href="/" className="text-indigo-400 hover:text-indigo-300 text-sm mb-4 inline-block">
        &larr; Dashboard
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{t('subtitle')}</p>
        </div>
      </div>

      {message && (
        <div className="mb-4 px-3 py-2 bg-emerald-900/30 text-emerald-400 text-sm rounded-lg border border-emerald-800">
          {message}
        </div>
      )}

      {/* Scope Selector */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('scope')}:</label>
        <select
          value={selectedScope}
          onChange={e => setSelectedScope(e.target.value)}
          className="px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:border-indigo-500"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
        >
          <option value="global">{t('global')}</option>
          {projects.map(p => (
            <option key={p.projectDir} value={p.projectDir}>
              {p.projectDir.split('/').slice(-2).join('/')} ({p.taskCount} tasks)
            </option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        {(['pipeline', 'agents', 'mcp', 'presets'] as const).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              tab === tabKey ? 'text-white' : 'hover:opacity-80'
            }`}
            style={tab === tabKey ? { background: 'var(--bg-card)' } : { color: 'var(--text-secondary)' }}
          >
            {tabKey === 'pipeline' ? t('pipeline') : tabKey === 'agents' ? t('agents') : tabKey === 'mcp' ? t('mcpServers') : t('presets')}
          </button>
        ))}
      </div>

      {/* Pipeline Tab */}
      {tab === 'pipeline' && (
        <div className="space-y-4">
          <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
            파이프라인 실행 흐름. 각 단계를 클릭하면 설정을 볼 수 있습니다.
          </p>

          <div className="flex flex-col items-center gap-2">
            {PIPELINE_STAGES.map((stage, i) => {
              const isExpanded = selectedStage === stage.id;
              const activeCount = stage.id === 'verify'
                ? VERIFICATION_STAGES.filter(v => pipelineConfig.verification[v.key as keyof VerificationStageConfig]).length
                : undefined;

              return (
                <div key={stage.id} className="w-full max-w-lg">
                  <button
                    onClick={() => setSelectedStage(isExpanded ? null : stage.id)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                      isExpanded
                        ? 'border-indigo-600/50'
                        : 'hover:opacity-90'
                    }`}
                    style={{ background: isExpanded ? 'var(--bg-card)' : 'var(--bg-secondary)', borderColor: isExpanded ? undefined : 'var(--border-color)' }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{stage.emoji}</span>
                        <div>
                          <p className="text-sm font-medium">{stage.name}</p>
                          <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{stage.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {stage.id === 'plan' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/30 text-indigo-400">
                            {pipelineConfig.planningMode}
                          </span>
                        )}
                        {stage.id === 'code' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/30 text-indigo-400">
                            {pipelineConfig.codingMode}
                          </span>
                        )}
                        {stage.id === 'verify' && activeCount !== undefined && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/30 text-indigo-400">
                            {activeCount}/{VERIFICATION_STAGES.length} stages
                          </span>
                        )}
                        {stage.mcpTools.length > 0 && stage.mcpTools.map(mcp => (
                          <span key={mcp} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400">
                            {mcp}
                          </span>
                        ))}
                        {stage.skippable && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400">
                            skippable
                          </span>
                        )}
                        {stage.expandable && (
                          <span className={`text-[10px] transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▾</span>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* --- Planning sub-options --- */}
                  {isExpanded && stage.id === 'plan' && (
                    <div className="mt-1 ml-6 border-l-2 border-indigo-600/30 pl-4 py-2 space-y-1">
                      {PLANNING_MODES.map(mode => (
                        <label key={mode.value} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:opacity-80 cursor-pointer">
                          <input
                            type="radio"
                            name="planningMode"
                            checked={pipelineConfig.planningMode === mode.value}
                            onChange={() => updateConfig(prev => ({ ...prev, planningMode: mode.value }))}
                            className="accent-indigo-500"
                          />
                          <div>
                            <p className="text-xs font-medium" style={{ color: pipelineConfig.planningMode === mode.value ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                              {mode.label}
                            </p>
                            <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{mode.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* --- Coding sub-options --- */}
                  {isExpanded && stage.id === 'code' && (
                    <div className="mt-1 ml-6 border-l-2 border-indigo-600/30 pl-4 py-2 space-y-1">
                      {CODING_MODES.map(mode => (
                        <label key={mode.value} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:opacity-80 cursor-pointer">
                          <input
                            type="radio"
                            name="codingMode"
                            checked={pipelineConfig.codingMode === mode.value}
                            onChange={() => updateConfig(prev => ({ ...prev, codingMode: mode.value }))}
                            className="accent-indigo-500"
                          />
                          <div>
                            <p className="text-xs font-medium" style={{ color: pipelineConfig.codingMode === mode.value ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                              {mode.label}
                            </p>
                            <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{mode.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* --- Verification sub-stages --- */}
                  {isExpanded && stage.id === 'verify' && (
                    <div className="mt-1 ml-6 border-l-2 border-indigo-600/30 pl-4 py-2 space-y-1">
                      {VERIFICATION_STAGES.map(vs => {
                        const enabled = pipelineConfig.verification[vs.key as keyof VerificationStageConfig] as boolean;
                        return (
                          <div key={vs.key} className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
                            enabled ? 'hover:opacity-80' : 'opacity-50'
                          }`}>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => !vs.locked && toggleVerification(vs.key)}
                                disabled={vs.locked}
                                className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                                  enabled
                                    ? 'bg-indigo-600 border-indigo-500 text-white'
                                    : ''
                                } ${vs.locked ? 'cursor-not-allowed' : 'cursor-pointer hover:border-indigo-400'}`}
                                style={!enabled ? { background: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' } : undefined}
                              >
                                {enabled && <span className="text-[10px]">✓</span>}
                              </button>
                              <div>
                                <p className="text-xs font-medium flex items-center gap-1" style={{ color: enabled ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                  {vs.label}
                                  {vs.locked && <span className="text-[9px] text-indigo-400">(필수)</span>}
                                  <Tooltip text={TOOLTIPS.verification[vs.key] ?? vs.desc} position="right" />
                                </p>
                                <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{vs.desc}</p>
                              </div>
                            </div>
                            {!enabled && !vs.locked && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}>disabled</span>
                            )}
                            {'hasRuns' in vs && vs.hasRuns && enabled && (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>runs:</span>
                                <select
                                  value={pipelineConfig.verification.vlmRuns}
                                  onChange={e => updateConfig(prev => ({
                                    ...prev,
                                    verification: { ...prev.verification, vlmRuns: Number(e.target.value) },
                                  }))}
                                  className="px-1 py-0.5 border rounded text-[10px]"
                                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                                >
                                  {[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* --- Generic stage details (non-expandable) --- */}
                  {isExpanded && !stage.expandable && (
                    <div className="mt-1 ml-6 border-l-2 pl-4 py-2 text-xs space-y-1" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
                      <div><span style={{ color: 'var(--text-secondary)' }}>Agent: </span>{stage.agentFile ?? 'N/A'}</div>
                      <div><span style={{ color: 'var(--text-secondary)' }}>MCP: </span>{stage.mcpTools.length > 0 ? stage.mcpTools.join(', ') : 'None'}</div>
                      {stage.skipCondition && <div><span style={{ color: 'var(--text-secondary)' }}>Skip: </span>{stage.skipCondition}</div>}
                      {stage.onFail && <div><span style={{ color: 'var(--text-secondary)' }}>On fail: </span>{stage.onFail}</div>}
                    </div>
                  )}

                  {i < PIPELINE_STAGES.length - 1 && (
                    <div className="flex justify-center py-1">
                      <div className="w-px h-4" style={{ background: 'var(--border-color)' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Save config button */}
          {configDirty && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => savePipelineConfig(pipelineConfig)}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
              >
                Save Pipeline Config
              </button>
            </div>
          )}

          <div className="mt-4 p-4 border rounded-xl max-w-lg mx-auto" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
            <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>재시도 &amp; 에스컬레이션</p>
            <div className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <p>• Verification 실패 → Coding으로 돌아감 (최대 3회)</p>
              <p>• 3회 실패 → Escalation 리포트 생성 + 롤백</p>
              <p>• Auto-cycle: 완료 후 다시 Planning (GOAL_COMPLETE까지)</p>
            </div>
          </div>

          {/* Harness Command */}
          <div className="mt-6 p-4 border rounded-xl max-w-lg mx-auto" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
            <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>자연어로 harness 설정 변경</p>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={harnessCommand}
                onChange={e => setHarnessCommand(e.target.value)}
                placeholder="예: Planning에서 context7 빼고 firecrawl 추가해줘"
                className="flex-1 px-3 py-2 border rounded-lg text-sm placeholder-gray-600 outline-none focus:border-indigo-600"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                onKeyDown={e => { if (e.key === 'Enter' && harnessCommand.trim()) handleHarnessCommand(); }}
              />
              <select
                value={commandCli}
                onChange={e => setCommandCli(e.target.value as 'claude-cli' | 'gemini-cli' | 'codex-cli' | 'api')}
                className="px-2 py-2 border rounded-lg text-xs"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              >
                <option value="claude-cli">Claude CLI</option>
                <option value="gemini-cli">Gemini CLI</option>
                <option value="codex-cli">Codex CLI</option>
                <option value="api">Claude API</option>
              </select>
              <button
                onClick={handleHarnessCommand}
                disabled={commandLoading || !harnessCommand.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg disabled:opacity-50"
              >
                {commandLoading ? '...' : 'Apply'}
              </button>
            </div>

            {commandLoading && (
              <div className="mt-2 p-3 border rounded-lg" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                <div className="flex items-center gap-2 text-xs">
                  <span className="animate-pulse text-indigo-400">●</span>
                  <span style={{ color: 'var(--text-primary)' }}>{commandCli}에 요청 중...</span>
                </div>
              </div>
            )}

            {!commandLoading && commandResult && (
              <div className={`mt-2 p-3 border rounded-lg ${
                commandResult.summary?.startsWith('Error')
                  ? 'bg-red-900/20 border-red-800/50'
                  : 'bg-emerald-900/20 border-emerald-800/50'
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-medium ${
                    commandResult.summary?.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'
                  }`}>
                    {commandResult.summary?.startsWith('Error') ? '✗ 실패' : '✓ 완료'}
                  </span>
                  <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                    {commandResult.cliMode && <span>{commandResult.cliMode}</span>}
                    {commandResult.durationMs && <span>{(commandResult.durationMs / 1000).toFixed(1)}s</span>}
                  </div>
                </div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-primary)' }}>{commandResult.summary}</p>
                {commandResult.changes.length > 0 && (
                  <div className="text-[10px] space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {commandResult.changes.map((c: string, i: number) => (
                      <p key={i}>• {c}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {harnessLog.length > 0 && (
              <div className="mt-4 max-w-lg mx-auto">
                <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>변경 이력</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {harnessLog.map((log, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] px-2 py-1 rounded" style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{new Date(log.timestamp).toLocaleString()}</span>
                      <span className={`px-1 rounded ${
                        log.action === 'command' ? 'bg-indigo-900/30 text-indigo-400' :
                        log.action === 'edit' ? 'bg-amber-900/30 text-amber-400' :
                        log.action === 'reset' ? 'bg-red-900/30 text-red-400' :
                        ''
                      }`} style={!['command', 'edit', 'reset'].includes(log.action) ? { background: 'var(--bg-card)', color: 'var(--text-secondary)' } : undefined}>
                        {log.action}
                      </span>
                      <span className="truncate flex-1" style={{ color: 'var(--text-secondary)' }}>
                        {log.command ?? log.summary ?? log.file ?? ''}
                      </span>
                      {log.cliMode && <span style={{ color: 'var(--text-secondary)' }}>{log.cliMode}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Agents Tab */}
      {tab === 'agents' && (
        <AgentsTab
          agents={agents}
          sourceColor={sourceColor}
          onEdit={handleEdit}
          onReset={handleReset}
          onEvolve={setEvolveRole}
        />
      )}

      {/* MCP Tab */}
      {tab === 'mcp' && (
        <div className="space-y-3">
          {mcpServers.length === 0 ? (
            <p className="text-sm p-4 rounded-lg border" style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
              No MCP servers configured.
            </p>
          ) : (
            mcpServers.map(server => (
              <div key={server.id} className="border rounded-xl p-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${server.enabled ? 'bg-emerald-400' : ''}`} style={!server.enabled ? { background: 'var(--text-secondary)' } : undefined} />
                    <h3 className="text-sm font-semibold">{server.id}</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
                      {server.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {server.stages.map(s => (
                      <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {server.url && <span>{server.url}</span>}
                  {server.command && <span>{server.command} {server.args?.join(' ')}</span>}
                </div>
              </div>
            ))
          )}
          <p className="text-xs mt-4" style={{ color: 'var(--text-secondary)' }}>
            MCP 설정을 변경하려면 ~/.autodev/mcp/config.json 또는 프로젝트/.autodev/mcp/config.json을 편집하세요.
          </p>
        </div>
      )}

      {/* Presets Tab */}
      {tab === 'presets' && (
        <div className="space-y-3">
          {['default', 'sniper', 'artisan', 'guardian', 'speed', 'experimental'].map(name => (
            <div key={name} className="border rounded-xl p-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold capitalize">{name}</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
                  built-in
                </span>
              </div>
            </div>
          ))}
          <p className="text-xs mt-4" style={{ color: 'var(--text-secondary)' }}>
            커스텀 프리셋을 추가하려면 ~/.autodev/presets/{'{name}'}.md 파일을 생성하세요.
          </p>
        </div>
      )}

      {/* Edit Modal */}
      {editingRole && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8">
          <div className="border rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{editingRole}.md</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                  selectedScope !== 'global' ? 'text-teal-400 bg-teal-900/30' : 'text-purple-400 bg-purple-900/30'
                }`}>
                  → {selectedScope !== 'global' ? 'project' : 'global'}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingRole(null)}
                  className="px-3 py-1 text-xs hover:opacity-80"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50"
                >
                  {saving ? 'Saving...' : selectedScope !== 'global' ? 'Save to Project' : 'Save'}
                </button>
              </div>
            </div>
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              className="flex-1 p-4 text-sm font-mono resize-none outline-none"
              style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              spellCheck={false}
            />
            {/* AI 수정 */}
            <AiEditBar
              editContent={editContent}
              editingRole={editingRole}
              onApply={(newContent) => setEditContent(newContent)}
            />
          </div>
        </div>
      )}

      {/* Evolve Modal */}
      {evolveRole && (
        <EvolveModal
          role={evolveRole}
          projectDir={selectedScope !== 'global' ? selectedScope : undefined}
          onClose={() => setEvolveRole(null)}
        />
      )}
    </div>
  );
}
