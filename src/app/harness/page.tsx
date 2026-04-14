'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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
] as const;

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

export default function HarnessPage() {
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
    return 'text-gray-400 bg-gray-800';
  };

  return (
    <div className="min-h-screen p-8 max-w-5xl mx-auto">
      <Link href="/" className="text-indigo-400 hover:text-indigo-300 text-sm mb-4 inline-block">
        &larr; Dashboard
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Harness Editor</h1>
          <p className="text-sm text-gray-500 mt-1">에이전트 프롬프트, MCP 설정, 프리셋 관리</p>
        </div>
      </div>

      {message && (
        <div className="mb-4 px-3 py-2 bg-emerald-900/30 text-emerald-400 text-sm rounded-lg border border-emerald-800">
          {message}
        </div>
      )}

      {/* Scope Selector */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs text-gray-500">Scope:</label>
        <select
          value={selectedScope}
          onChange={e => setSelectedScope(e.target.value)}
          className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="global">Global (~/.autodev/)</option>
          {projects.map(p => (
            <option key={p.projectDir} value={p.projectDir}>
              {p.projectDir.split('/').slice(-2).join('/')} ({p.taskCount} tasks)
            </option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        {(['pipeline', 'agents', 'mcp', 'presets'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              tab === t ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t === 'pipeline' ? 'Pipeline' : t === 'agents' ? 'Agents' : t === 'mcp' ? 'MCP Servers' : 'Presets'}
          </button>
        ))}
      </div>

      {/* Pipeline Tab */}
      {tab === 'pipeline' && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500 mb-4">
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
                        ? 'bg-gray-800 border-indigo-600/50'
                        : 'bg-gray-900/50 border-gray-800 hover:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{stage.emoji}</span>
                        <div>
                          <p className="text-sm font-medium">{stage.name}</p>
                          <p className="text-[10px] text-gray-500">{stage.description}</p>
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
                        <label key={mode.value} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800/50 cursor-pointer">
                          <input
                            type="radio"
                            name="planningMode"
                            checked={pipelineConfig.planningMode === mode.value}
                            onChange={() => updateConfig(prev => ({ ...prev, planningMode: mode.value }))}
                            className="accent-indigo-500"
                          />
                          <div>
                            <p className={`text-xs font-medium ${pipelineConfig.planningMode === mode.value ? 'text-white' : 'text-gray-400'}`}>
                              {mode.label}
                            </p>
                            <p className="text-[10px] text-gray-600">{mode.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* --- Coding sub-options --- */}
                  {isExpanded && stage.id === 'code' && (
                    <div className="mt-1 ml-6 border-l-2 border-indigo-600/30 pl-4 py-2 space-y-1">
                      {CODING_MODES.map(mode => (
                        <label key={mode.value} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800/50 cursor-pointer">
                          <input
                            type="radio"
                            name="codingMode"
                            checked={pipelineConfig.codingMode === mode.value}
                            onChange={() => updateConfig(prev => ({ ...prev, codingMode: mode.value }))}
                            className="accent-indigo-500"
                          />
                          <div>
                            <p className={`text-xs font-medium ${pipelineConfig.codingMode === mode.value ? 'text-white' : 'text-gray-400'}`}>
                              {mode.label}
                            </p>
                            <p className="text-[10px] text-gray-600">{mode.desc}</p>
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
                            enabled ? 'hover:bg-gray-800/50' : 'opacity-50'
                          }`}>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => !vs.locked && toggleVerification(vs.key)}
                                disabled={vs.locked}
                                className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                                  enabled
                                    ? 'bg-indigo-600 border-indigo-500 text-white'
                                    : 'bg-gray-800 border-gray-700 text-gray-600'
                                } ${vs.locked ? 'cursor-not-allowed' : 'cursor-pointer hover:border-indigo-400'}`}
                              >
                                {enabled && <span className="text-[10px]">✓</span>}
                              </button>
                              <div>
                                <p className={`text-xs font-medium ${enabled ? 'text-white' : 'text-gray-500'}`}>
                                  {vs.label}
                                  {vs.locked && <span className="ml-1 text-[9px] text-indigo-400">(필수)</span>}
                                </p>
                                <p className={`text-[10px] ${enabled ? 'text-gray-500' : 'text-gray-700'}`}>{vs.desc}</p>
                              </div>
                            </div>
                            {!enabled && !vs.locked && (
                              <span className="text-[9px] text-gray-600 px-1.5 py-0.5 rounded bg-gray-800">disabled</span>
                            )}
                            {'hasRuns' in vs && vs.hasRuns && enabled && (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-gray-500">runs:</span>
                                <select
                                  value={pipelineConfig.verification.vlmRuns}
                                  onChange={e => updateConfig(prev => ({
                                    ...prev,
                                    verification: { ...prev.verification, vlmRuns: Number(e.target.value) },
                                  }))}
                                  className="px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-[10px] text-gray-300"
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
                    <div className="mt-1 ml-6 border-l-2 border-gray-700/50 pl-4 py-2 text-xs text-gray-400 space-y-1">
                      <div><span className="text-gray-500">Agent: </span>{stage.agentFile ?? 'N/A'}</div>
                      <div><span className="text-gray-500">MCP: </span>{stage.mcpTools.length > 0 ? stage.mcpTools.join(', ') : 'None'}</div>
                      {stage.skipCondition && <div><span className="text-gray-500">Skip: </span>{stage.skipCondition}</div>}
                      {stage.onFail && <div><span className="text-gray-500">On fail: </span>{stage.onFail}</div>}
                    </div>
                  )}

                  {i < PIPELINE_STAGES.length - 1 && (
                    <div className="flex justify-center py-1">
                      <div className={`w-px h-4 ${
                        stage.id === 'verify' && !pipelineConfig.verification.browser && !pipelineConfig.verification.vlm
                          ? 'bg-gray-800 border-dashed' : 'bg-gray-700'
                      }`} />
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

          <div className="mt-4 p-4 bg-gray-900/30 border border-gray-800 rounded-xl max-w-lg mx-auto">
            <p className="text-xs text-gray-500 mb-2">재시도 &amp; 에스컬레이션</p>
            <div className="text-xs text-gray-400 space-y-1">
              <p>• Verification 실패 → Coding으로 돌아감 (최대 3회)</p>
              <p>• 3회 실패 → Escalation 리포트 생성 + 롤백</p>
              <p>• Auto-cycle: 완료 후 다시 Planning (GOAL_COMPLETE까지)</p>
            </div>
          </div>

          {/* Harness Command */}
          <div className="mt-6 p-4 bg-gray-900/50 border border-gray-800 rounded-xl max-w-lg mx-auto">
            <p className="text-xs text-gray-500 mb-3">자연어로 harness 설정 변경</p>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={harnessCommand}
                onChange={e => setHarnessCommand(e.target.value)}
                placeholder="예: Planning에서 context7 빼고 firecrawl 추가해줘"
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-indigo-600"
                onKeyDown={e => { if (e.key === 'Enter' && harnessCommand.trim()) handleHarnessCommand(); }}
              />
              <select
                value={commandCli}
                onChange={e => setCommandCli(e.target.value as 'claude-cli' | 'gemini-cli' | 'codex-cli' | 'api')}
                className="px-2 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300"
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
              <div className="mt-2 p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
                <div className="flex items-center gap-2 text-xs">
                  <span className="animate-pulse text-indigo-400">●</span>
                  <span className="text-gray-300">{commandCli}에 요청 중...</span>
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
                  <div className="flex items-center gap-2 text-[10px] text-gray-500">
                    {commandResult.cliMode && <span>{commandResult.cliMode}</span>}
                    {commandResult.durationMs && <span>{(commandResult.durationMs / 1000).toFixed(1)}s</span>}
                  </div>
                </div>
                <p className="text-xs text-gray-300 mb-1">{commandResult.summary}</p>
                {commandResult.changes.length > 0 && (
                  <div className="text-[10px] text-gray-500 space-y-0.5">
                    {commandResult.changes.map((c: string, i: number) => (
                      <p key={i}>• {c}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {harnessLog.length > 0 && (
              <div className="mt-4 max-w-lg mx-auto">
                <p className="text-xs text-gray-500 mb-2">변경 이력</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {harnessLog.map((log, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] text-gray-500 px-2 py-1 bg-gray-900/30 rounded">
                      <span className="text-gray-600">{new Date(log.timestamp).toLocaleString()}</span>
                      <span className={`px-1 rounded ${
                        log.action === 'command' ? 'bg-indigo-900/30 text-indigo-400' :
                        log.action === 'edit' ? 'bg-amber-900/30 text-amber-400' :
                        log.action === 'reset' ? 'bg-red-900/30 text-red-400' :
                        'bg-gray-800 text-gray-400'
                      }`}>
                        {log.action}
                      </span>
                      <span className="text-gray-400 truncate flex-1">
                        {log.command ?? log.summary ?? log.file ?? ''}
                      </span>
                      {log.cliMode && <span className="text-gray-600">{log.cliMode}</span>}
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
        <div className="space-y-3">
          {agents.map(agent => (
            <div key={agent.role} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold">{agent.role}.md</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${sourceColor(agent.source)}`}>
                    {agent.source}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(agent.role, agent.content)}
                    className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                  >
                    Edit
                  </button>
                  {agent.source !== 'default' && (
                    <button
                      onClick={() => handleReset(agent.role)}
                      className="px-3 py-1 text-xs text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
              <pre className="text-xs text-gray-400 max-h-32 overflow-y-auto whitespace-pre-wrap bg-gray-950 rounded-lg p-3">
                {agent.content.slice(0, 500)}{agent.content.length > 500 ? '...' : ''}
              </pre>
              {agent.filePath && (
                <p className="text-[10px] text-gray-600 mt-2">{agent.filePath}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* MCP Tab */}
      {tab === 'mcp' && (
        <div className="space-y-3">
          {mcpServers.length === 0 ? (
            <p className="text-gray-500 text-sm p-4 bg-gray-900 rounded-lg border border-gray-800">
              No MCP servers configured.
            </p>
          ) : (
            mcpServers.map(server => (
              <div key={server.id} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${server.enabled ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                    <h3 className="text-sm font-semibold">{server.id}</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
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
                <div className="mt-2 text-xs text-gray-500">
                  {server.url && <span>{server.url}</span>}
                  {server.command && <span>{server.command} {server.args?.join(' ')}</span>}
                </div>
              </div>
            ))
          )}
          <p className="text-xs text-gray-600 mt-4">
            MCP 설정을 변경하려면 ~/.autodev/mcp/config.json 또는 프로젝트/.autodev/mcp/config.json을 편집하세요.
          </p>
        </div>
      )}

      {/* Presets Tab */}
      {tab === 'presets' && (
        <div className="space-y-3">
          {['default', 'sniper', 'artisan', 'guardian', 'speed', 'experimental'].map(name => (
            <div key={name} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold capitalize">{name}</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                  built-in
                </span>
              </div>
            </div>
          ))}
          <p className="text-xs text-gray-600 mt-4">
            커스텀 프리셋을 추가하려면 ~/.autodev/presets/{'{name}'}.md 파일을 생성하세요.
          </p>
        </div>
      )}

      {/* Edit Modal */}
      {editingRole && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
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
                  className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200"
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
              className="flex-1 p-4 bg-gray-950 text-sm text-gray-200 font-mono resize-none outline-none"
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}
