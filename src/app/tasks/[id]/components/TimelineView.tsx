'use client';

import { useMemo } from 'react';
import { StageNode } from './StageNode';
import {
  type PipelineEvent, type PlanData, type LiveUsage,
  type VerificationResult, type ScreenshotData, type CycleInfo,
  STAGES, formatElapsed,
} from './types';

interface Props {
  currentStatus: string;
  planData: PlanData | null;
  liveEvents: PipelineEvent[];
  liveUsage: LiveUsage;
  verificationResults: VerificationResult[];
  screenshots: ScreenshotData[];
  cycleInfo: CycleInfo;
  taskCreatedAt: string;
  taskId: string;
  onStopCycle?: () => void;
}

interface StageInfo {
  stage: string;
  status: 'done' | 'active' | 'pending';
  duration?: string;
  agentId?: string;
}

export function TimelineView({
  currentStatus, planData, liveEvents, liveUsage,
  verificationResults, screenshots, cycleInfo,
  taskCreatedAt, taskId, onStopCycle,
}: Props) {
  // 타임라인에 표시할 단계 계산
  const stages = useMemo(() => {
    const currentIdx = STAGES.indexOf(currentStatus);
    const isFailed = currentStatus === 'failed' || currentStatus === 'escalated';
    const result: StageInfo[] = [];

    // 기본 단계들
    const visibleStages = isFailed
      ? [...STAGES.slice(0, currentIdx >= 0 ? currentIdx : STAGES.length), currentStatus]
      : STAGES;

    for (const stage of visibleStages) {
      const stageIdx = STAGES.indexOf(stage);
      let status: 'done' | 'active' | 'pending' = 'pending';
      if (stage === currentStatus) {
        status = ['completed', 'failed', 'escalated'].includes(stage) ? 'done' : 'active';
      } else if (stageIdx >= 0 && stageIdx < currentIdx) {
        status = 'done';
      } else if (currentStatus === 'completed') {
        status = 'done';
      }

      // plan_review는 건너뛰기 (Planning에 통합)
      if (stage === 'plan_review') continue;
      // pending은 표시하지 않음 (의미 없는 노드)
      if (stage === 'pending') continue;

      const agentId = stage === 'coding'
        ? liveEvents.find(e => e.type === 'attempt_start')?.agentId as string | undefined
        : undefined;

      result.push({ stage, status, agentId });
    }

    return result;
  }, [currentStatus, liveEvents]);

  // Verify 데이터 집계
  const verifyData = useMemo(() => {
    if (verificationResults.length === 0) return undefined;
    const passed = verificationResults.filter(v => v.status === 'pass').length;
    const total = verificationResults.length;
    // LLM score는 verify-agent 결과에서 추출
    const llmResult = verificationResults.find(v => v.checkId.includes('verify-agent') || v.checkId.includes('llm'));
    const scoreMatch = llmResult?.detail?.match(/(\d+)\s*\/\s*100/);
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : undefined;
    // VLM score
    const vlmResult = verificationResults.find(v => v.checkId.includes('vlm') || v.checkId.includes('design'));
    const vlmMatch = vlmResult?.detail?.match(/(\d+)\s*\/\s*(\d+)/);
    const designScore = vlmMatch ? parseInt(vlmMatch[1], 10) : undefined;
    // 스크린샷
    const screenshotUrl = screenshots.length > 0
      ? `/api/screenshots/${encodeURIComponent(screenshots[screenshots.length - 1].path)}`
      : undefined;

    return { passedChecks: passed, totalChecks: total, score, designScore, screenshotUrl };
  }, [verificationResults, screenshots]);

  // 코딩 비용
  const codingCost = liveUsage.agentCosts[Object.keys(liveUsage.agentCosts).find(k => k !== 'planning' && k !== 'verify') ?? ''] ?? 0;

  return (
    <div className="space-y-0">
      {/* Auto-cycle 진행 바 */}
      {cycleInfo.max > 1 && (
        <div className="mb-4 p-3 bg-amber-950/20 rounded-lg border border-amber-800/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-amber-400 font-medium">
              Auto-cycle: {cycleInfo.current}/{cycleInfo.max}
            </span>
            {!['completed', 'failed', 'escalated'].includes(currentStatus) && onStopCycle && (
              <button
                onClick={onStopCycle}
                className="px-2 py-1 text-xs bg-red-900/50 hover:bg-red-900 text-red-300 rounded transition-colors"
              >
                Stop
              </button>
            )}
          </div>
          <div className="w-full rounded-full h-1.5 mb-2" style={{ background: 'var(--bg-card)' }}>
            <div
              className="bg-amber-500 h-1.5 rounded-full transition-all"
              style={{ width: `${(cycleInfo.current / cycleInfo.max) * 100}%` }}
            />
          </div>
          {cycleInfo.steps.length > 0 && (
            <div className="space-y-1 mt-2">
              {cycleInfo.steps.map((step, i) => (
                <p key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>{step}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 타임라인 노드 */}
      {stages.map((s, i) => (
        <StageNode
          key={s.stage}
          stage={s.stage}
          status={s.status}
          duration={s.duration}
          agentId={s.agentId}
          isLast={i === stages.length - 1}
          planData={s.stage === 'planning' ? planData : undefined}
          planCost={s.stage === 'planning' ? liveUsage.agentCosts['planning'] : undefined}
          codingSummary={s.stage === 'coding' ? `Coding with ${s.agentId ?? 'agent'}` : undefined}
          codingCost={s.stage === 'coding' ? codingCost : undefined}
          verifyData={s.stage === 'verifying' ? verifyData : undefined}
        />
      ))}

      {/* Live Events 로그 (접을 수 있음) */}
      <details className="mt-4">
        <summary className="text-xs cursor-pointer hover:opacity-80 transition-colors" style={{ color: 'var(--text-secondary)' }}>
          Live events ({liveEvents.length})
        </summary>
        <div className="mt-2 rounded-lg border p-3 max-h-64 overflow-y-auto space-y-1" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
          {liveEvents.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Waiting for events...</p>
          ) : (
            liveEvents.map((event, i) => (
              <div key={i} className="text-xs font-mono">
                {event.type === 'status_change' && (
                  <span className="text-blue-400">[{event.status}] {event.message}</span>
                )}
                {event.type === 'log' && (
                  <span className={event.level === 'error' ? 'text-red-400' : event.level === 'warn' ? 'text-yellow-400' : ''} style={event.level !== 'error' && event.level !== 'warn' ? { color: 'var(--text-secondary)' } : undefined}>
                    [{event.level}] {event.message}
                  </span>
                )}
                {event.type === 'task_complete' && (
                  <span className={event.success ? 'text-green-400' : 'text-red-400'}>
                    [complete] {event.summary}
                  </span>
                )}
                {event.type === 'attempt_start' && (
                  <span className="text-purple-400">
                    [coding] Starting attempt #{event.attemptNum} with {event.agentId}
                  </span>
                )}
                {event.type === 'attempt_complete' && (
                  <span className={event.success ? 'text-green-400' : 'text-red-400'}>
                    [attempt] #{event.attemptNum} {event.success ? 'succeeded' : 'failed'}
                    {event.error ? `: ${event.error}` : ''}
                  </span>
                )}
                {event.type === 'verification_result' && (
                  <span className={event.status === 'pass' ? 'text-green-400' : event.status === 'fail' ? 'text-red-400' : ''} style={event.status !== 'pass' && event.status !== 'fail' ? { color: 'var(--text-secondary)' } : undefined}>
                    [{event.status === 'pass' ? '\u2713' : event.status === 'fail' ? '\u2717' : '\u25CB'}] {event.detail}
                  </span>
                )}
                {event.type === 'screenshot' && (
                  <span className="text-cyan-400">[capture] Screenshot for {event.checkId}</span>
                )}
                {event.type === 'escalation' && (
                  <span className="text-red-400">[escalation] Task escalated</span>
                )}
                {event.type === 'cycle_start' && (
                  <span className="text-amber-400">[cycle] Starting {event.cycleNum}/{event.totalCycles}</span>
                )}
                {event.type === 'cycle_complete' && (
                  <span className={event.success ? 'text-green-400' : 'text-yellow-400'}>
                    [cycle] Cycle {event.cycleNum} {event.success ? 'done' : 'failed'}: {event.summary}
                  </span>
                )}
                {event.type === 'auto_cycle_complete' && (
                  <span className="text-amber-300">[auto-cycle] {event.summary}</span>
                )}
                {event.type === 'cost_update' && (
                  <span className="text-emerald-400">
                    [cost] ${((event as any).costUsd ?? 0).toFixed(4)} — {(event as any).agentId}
                  </span>
                )}
                {event.type === 'agent_switch' && (
                  <span className="text-orange-400">
                    [switch] {(event as any).fromAgent} → {(event as any).toAgent} — {(event as any).reason}
                  </span>
                )}
                {!['status_change', 'log', 'task_complete', 'attempt_start', 'attempt_complete',
                  'verification_result', 'screenshot', 'escalation', 'cycle_start', 'cycle_complete',
                  'auto_cycle_complete', 'cost_update', 'interview_questions', 'plan_ready', 'agent_switch'].includes(event.type) && (
                  <span style={{ color: 'var(--text-secondary)' }}>[{event.type}] {JSON.stringify(event)}</span>
                )}
              </div>
            ))
          )}
        </div>
      </details>
    </div>
  );
}
