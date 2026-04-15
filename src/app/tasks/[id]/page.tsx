'use client';

import { useState, useEffect, useMemo, use } from 'react';
import { useRouter } from 'next/navigation';
import { TaskHeader } from './components/TaskHeader';
import { TimelineView } from './components/TimelineView';
import { DiffView } from './components/DiffView';
import { ArtifactView } from './components/ArtifactView';
import { Sidebar } from './components/Sidebar';
import type { TaskDetail, PipelineEvent, PlanData, LiveUsage, VerificationResult, ScreenshotData, CycleInfo } from './components/types';

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  // --- State ---
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [liveEvents, setLiveEvents] = useState<PipelineEvent[]>([]);
  const [screenshots, setScreenshots] = useState<ScreenshotData[]>([]);
  const [currentStatus, setCurrentStatus] = useState('pending');
  const [verificationResults, setVerificationResults] = useState<VerificationResult[]>([]);
  const [escalationReport, setEscalationReport] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(1);
  const [planData, setPlanData] = useState<PlanData | null>(null);
  const [editingPlan, setEditingPlan] = useState(false);
  const [editedCodingPrompt, setEditedCodingPrompt] = useState('');
  const [previewFile, setPreviewFile] = useState<{ path: string; content: string; language: string } | null>(null);
  const [projectTasks, setProjectTasks] = useState<Array<{ id: string; prompt: string; status: string; createdAt: string }>>([]);
  const [interviewQuestions, setInterviewQuestions] = useState<string[]>([]);
  const [interviewAnswers, setInterviewAnswers] = useState<Record<number, string>>({});
  const [submittingAnswers, setSubmittingAnswers] = useState(false);
  const [cycleInfo, setCycleInfo] = useState<CycleInfo>({ current: 0, max: 0, steps: [] });
  const [planTab, setPlanTab] = useState<'json' | 'diagram' | 'cards'>('json');
  const [artifactFiles, setArtifactFiles] = useState<Record<string, string>>({});
  const [diffData, setDiffData] = useState<any>(null);
  const [diffView, setDiffView] = useState<'unified' | 'split'>('unified');
  const [diffLoading, setDiffLoading] = useState(false);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);
  const [liveUsage, setLiveUsage] = useState<LiveUsage>({
    totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, agentCosts: {},
  });
  const [activeTab, setActiveTab] = useState<'timeline' | 'diff' | 'artifacts'>('timeline');

  // --- Helper: parse raw events into state ---
  const hydrateEvents = (rawEvents: any[]) => {
    const storedEvents: PipelineEvent[] = [];
    const storedVerifications: VerificationResult[] = [];
    const storedScreenshots: ScreenshotData[] = [];
    let storedEscalation: string | null = null;
    let maxAttempt = 1;
    const storedUsage = { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, agentCosts: {} as Record<string, number> };

    for (const evt of rawEvents) {
      try {
        const parsed: PipelineEvent = typeof evt.data === 'string' ? JSON.parse(evt.data) : evt.data;
        if (!parsed.type) continue;
        storedEvents.push(parsed);

        if (parsed.type === 'verification_result') {
          storedVerifications.push({
            checkId: parsed.checkId as string,
            status: (parsed.status ?? 'skip') as string,
            detail: parsed.detail as string,
          });
        }
        if (parsed.type === 'screenshot') {
          storedScreenshots.push({ path: parsed.path as string, checkId: parsed.checkId as string });
        }
        if (parsed.type === 'escalation') {
          storedEscalation = parsed.report as string;
        }
        if (parsed.type === 'attempt_start' && typeof parsed.attemptNum === 'number') {
          maxAttempt = Math.max(maxAttempt, parsed.attemptNum);
        }
        if (parsed.type === 'cycle_start') {
          setCycleInfo(prev => ({ ...prev, current: parsed.cycleNum as number, max: parsed.totalCycles as number }));
        }
        if (parsed.type === 'cycle_complete') {
          setCycleInfo(prev => ({ ...prev, steps: [...prev.steps, `${parsed.success ? '\u2713' : '\u2717'} ${parsed.summary}`] }));
        }
        if (parsed.type === 'plan_ready') {
          setPlanData(parsed.plan as any);
          setEditedCodingPrompt((parsed.plan as any)?.codingPrompt ?? '');
        }
        if (parsed.type === 'interview_questions') {
          setInterviewQuestions((parsed as any).questions ?? []);
        }
        if (parsed.type === 'cost_update') {
          storedUsage.totalCostUsd = (parsed as any).totalCostUsd ?? storedUsage.totalCostUsd;
          storedUsage.totalInputTokens += (parsed as any).inputTokens ?? 0;
          storedUsage.totalOutputTokens += (parsed as any).outputTokens ?? 0;
          const aid = (parsed as any).agentId as string;
          if (aid) storedUsage.agentCosts[aid] = (storedUsage.agentCosts[aid] ?? 0) + ((parsed as any).costUsd ?? 0);
        }
      } catch { /* skip unparseable events */ }
    }

    setLiveEvents(storedEvents);
    setVerificationResults(storedVerifications);
    setScreenshots(storedScreenshots);
    if (storedEscalation) setEscalationReport(storedEscalation);
    setAttemptCount(maxAttempt);
    setLiveUsage(storedUsage);
  };

  // --- Initial fetch: task metadata only (fast) ---
  useEffect(() => {
    window.scrollTo(0, 0);

    fetch(`/api/tasks/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setTask(data);
        setCurrentStatus(data.status);

        if (data.maxCycles > 1) {
          setCycleInfo(prev => ({ ...prev, current: data.cycleCount ?? 0, max: data.maxCycles ?? 0 }));
        }

        if (data.plan) {
          const plan = typeof data.plan === 'string' ? JSON.parse(data.plan) : data.plan;
          setPlanData(plan);
          setEditedCodingPrompt(plan.codingPrompt ?? '');
        }
      });
  }, [id]);

  // --- Deferred: load events separately (non-blocking) ---
  useEffect(() => {
    fetch(`/api/tasks/${id}/events`)
      .then((r) => r.json())
      .then((data) => {
        if (data.events && data.events.length > 0) {
          hydrateEvents(data.events);
        }
      })
      .catch(() => {});
  }, [id]);

  // --- Project tasks ---
  useEffect(() => {
    if (task?.projectDir) {
      fetch(`/api/tasks?projectDir=${encodeURIComponent(task.projectDir)}&limit=10`)
        .then(r => r.json())
        .then(data => setProjectTasks(data.filter((t: any) => t.id !== id)))
        .catch(() => {});
    }
  }, [task?.projectDir, id]);

  // --- SSE: only for active tasks ---
  const isTerminal = ['completed', 'failed', 'escalated'].includes(currentStatus);
  useEffect(() => {
    if (isTerminal) return;
    const es = new EventSource(`/api/events?taskId=${id}`);
    es.onmessage = (e) => {
      const event: PipelineEvent = JSON.parse(e.data);
      setLiveEvents((prev) => [...prev, event]);
      if (event.type === 'status_change' && event.status) {
        setCurrentStatus(event.status);
      }
      if (event.type === 'task_complete') {
        setCurrentStatus(event.success ? 'completed' : 'failed');
        fetch(`/api/tasks/${id}`).then((r) => r.json()).then(setTask);
      }
      if (event.type === 'screenshot') {
        setScreenshots((prev) => [...prev, { path: event.path, checkId: event.checkId }]);
      }
      if (event.type === 'verification_result') {
        setVerificationResults((prev) => [...prev, { checkId: event.checkId as string, status: (event.status ?? 'skip') as string, detail: event.detail as string }]);
      }
      if (event.type === 'escalation') {
        setEscalationReport(event.report);
      }
      if (event.type === 'plan_ready') {
        setPlanData(event.plan as any);
        setEditedCodingPrompt((event.plan as any)?.codingPrompt ?? '');
      }
      if (event.type === 'interview_questions') {
        setInterviewQuestions((event as any).questions ?? []);
      }
      if (event.type === 'attempt_start') {
        setAttemptCount(event.attemptNum);
      }
      if (event.type === 'cycle_start') {
        setCycleInfo(prev => ({ ...prev, current: event.cycleNum as number, max: event.totalCycles as number }));
      }
      if (event.type === 'cycle_complete') {
        setCycleInfo(prev => ({ ...prev, steps: [...prev.steps, `${event.success ? '\u2713' : '\u2717'} ${event.summary}`] }));
      }
      if (event.type === 'cost_update') {
        setLiveUsage(prev => ({
          totalCostUsd: (event as any).totalCostUsd,
          totalInputTokens: prev.totalInputTokens + ((event as any).inputTokens ?? 0),
          totalOutputTokens: prev.totalOutputTokens + ((event as any).outputTokens ?? 0),
          agentCosts: {
            ...prev.agentCosts,
            [(event as any).agentId]: (prev.agentCosts[(event as any).agentId] ?? 0) + ((event as any).costUsd ?? 0),
          },
        }));
      }
    };
    return () => es.close();
  }, [id, isTerminal]);

  // --- Handlers ---
  const loadFilePreview = async (filePath: string) => {
    if (!task?.projectDir) return;
    if (previewFile?.path === filePath) {
      setPreviewFile(null);
      return;
    }
    try {
      const res = await fetch(`/api/files?projectDir=${encodeURIComponent(task.projectDir)}&file=${encodeURIComponent(filePath)}`);
      if (res.ok) {
        const data = await res.json();
        setPreviewFile(data);
      }
    } catch {}
  };

  const loadDiff = async () => {
    if (!task?.projectDir || diffData) return;
    setDiffLoading(true);
    try {
      const result = task.result
        ? (() => { try { return typeof task.result === 'string' ? JSON.parse(task.result) : task.result; } catch { return null; } })()
        : null;
      const commitHash: string = result?.commitHash ?? '';
      const params = new URLSearchParams({ projectDir: task.projectDir });
      if (commitHash) params.set('commit', commitHash);
      const res = await fetch(`/api/diff?${params}`);
      if (res.ok) {
        const data = await res.json();
        setDiffData(data);
      }
    } catch { /* ignore */ } finally {
      setDiffLoading(false);
    }
  };

  const toggleDiffFile = async (filePath: string) => {
    if (selectedDiffFile === filePath) {
      setSelectedDiffFile(null);
      return;
    }
    setSelectedDiffFile(filePath);
    if (!diffData) await loadDiff();
  };

  const parsedResult = task?.result
    ? (() => { try { return typeof task.result === 'string' ? JSON.parse(task.result) : task.result; } catch { return null; } })()
    : null;

  const handleApprovePlan = async (edited?: boolean) => {
    const planToSend = edited ? { ...planData, codingPrompt: editedCodingPrompt } : undefined;
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', plan: planToSend }),
    });
  };

  const handleRejectPlan = async () => {
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject' }),
    });
    setCurrentStatus('failed');
  };

  const handleSubmitInterview = async (answers: Record<number, string>) => {
    setSubmittingAnswers(true);
    await fetch(`/api/tasks/${id}/interview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    setSubmittingAnswers(false);
    setCurrentStatus('pending');
  };

  const handleSkipInterview = async () => {
    await fetch(`/api/tasks/${id}/interview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: {} }),
    });
    setCurrentStatus('pending');
  };

  const handleStopCycle = async () => {
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });
  };

  const verifyResult = useMemo(() => {
    // 1. Check verification_result events
    const verifyEvents = liveEvents.filter(e => e.type === 'verification_result');
    const last = verifyEvents[verifyEvents.length - 1];
    if (last && (last.score != null || (last.detail as any)?.score != null)) {
      return {
        score: last.score ?? (last.detail as any)?.score ?? null,
        verdict: last.verdict ?? (last.detail as any)?.verdict ?? 'unknown',
        issues: last.issues ?? (last.detail as any)?.issues ?? [],
        designScore: last.designScore ?? (last.detail as any)?.designScore ?? null,
        agentId: last.agentId ?? (last.detail as any)?.agentId ?? null,
      };
    }

    // 2. Check task_complete event for score
    const completeEvent = liveEvents.findLast(e => e.type === 'task_complete');
    if (completeEvent?.score != null) {
      return {
        score: completeEvent.score,
        verdict: completeEvent.verdict ?? (completeEvent.success ? 'pass' : 'fail'),
        issues: completeEvent.issues ?? [],
        designScore: completeEvent.designScore ?? null,
        agentId: completeEvent.agentId ?? null,
      };
    }

    // 3. Check parsedResult for verification data
    if (parsedResult?.score != null) {
      return {
        score: parsedResult.score,
        verdict: parsedResult.verdict ?? (parsedResult.passed ? 'pass' : 'fail'),
        issues: parsedResult.issues ?? [],
        designScore: parsedResult.designScore ?? null,
        agentId: parsedResult.verifyAgentId ?? parsedResult.agentId ?? null,
      };
    }

    // 4. Derive from individual verification results
    if (verificationResults.length > 0) {
      const passCount = verificationResults.filter(v => v.status === 'pass').length;
      const total = verificationResults.length;
      return {
        score: Math.round((passCount / total) * 100),
        verdict: passCount === total ? 'pass' : passCount > 0 ? 're-code' : 'fail',
        issues: verificationResults.filter(v => v.status === 'fail').map(v => v.detail),
        designScore: null,
        agentId: null,
      };
    }

    return null;
  }, [liveEvents, parsedResult, verificationResults]);

  // --- Load artifact files for completed tasks ---
  const parsedResultForArtifacts = parsedResult;
  useEffect(() => {
    if (!task?.projectDir || !['completed'].includes(currentStatus)) return;
    const modifiedFiles: string[] = parsedResultForArtifacts?.modifiedFiles ?? [];
    const previewableFiles = modifiedFiles.filter(f =>
      /\.(html?|css|js|jsx|ts|tsx|json)$/i.test(f)
    );
    if (previewableFiles.length === 0) return;
    // Only load HTML bundles (html + their css/js)
    const hasHtml = previewableFiles.some(f => /\.html?$/i.test(f));
    if (!hasHtml) return;

    Promise.all(
      previewableFiles.map(f =>
        fetch(`/api/files?projectDir=${encodeURIComponent(task.projectDir!)}&file=${encodeURIComponent(f)}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => data ? [f, data.content as string] as const : null)
          .catch(() => null)
      )
    ).then(entries => {
      const valid = entries.filter((e): e is [string, string] => e !== null);
      if (valid.length > 0) setArtifactFiles(Object.fromEntries(valid));
    });
  }, [task?.projectDir, currentStatus, parsedResultForArtifacts]);

  // --- Loading ---
  if (!task) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          <span className="text-sm text-gray-500">Loading task...</span>
        </div>
      </div>
    );
  }

  // --- Render ---
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col">
      <TaskHeader
        task={task}
        currentStatus={currentStatus}
        liveUsage={liveUsage}
        attemptCount={attemptCount}
      />

      {/* Split panel: 7:3 on md+, stacked on mobile */}
      <div className="flex-1 flex flex-col md:grid md:grid-cols-[7fr_3fr] md:h-[calc(100vh-48px)]">
        {/* Left panel — Tabs */}
        <div className="border-b md:border-b-0 md:border-r border-gray-800 flex flex-col min-h-0">
          <div className="flex border-b border-gray-800 flex-shrink-0">
            {(['timeline', 'diff', 'artifacts'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-indigo-500 text-indigo-400 bg-gray-900/50'
                    : 'border-transparent text-gray-500 hover:text-gray-400'
                }`}
              >
                {tab === 'timeline' ? 'Timeline' : tab === 'diff' ? 'Diff' : 'Artifacts'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {activeTab === 'timeline' && (
              <TimelineView
                currentStatus={currentStatus}
                planData={planData}
                liveEvents={liveEvents}
                liveUsage={liveUsage}
                verificationResults={verificationResults}
                screenshots={screenshots}
                cycleInfo={cycleInfo}
                taskCreatedAt={task.createdAt}
                taskId={id}
                onStopCycle={handleStopCycle}
              />
            )}
            {activeTab === 'diff' && (
              <DiffView
                task={task}
                parsedResult={parsedResult}
                diffData={diffData}
                diffLoading={diffLoading}
                diffView={diffView}
                selectedDiffFile={selectedDiffFile}
                previewFile={previewFile}
                onSetDiffView={setDiffView}
                onLoadDiff={loadDiff}
                onToggleDiffFile={toggleDiffFile}
                onLoadFilePreview={loadFilePreview}
              />
            )}
            {activeTab === 'artifacts' && (
              <ArtifactView
                planData={planData}
                screenshots={screenshots}
                verificationResults={verificationResults}
                escalationReport={escalationReport}
                artifactFiles={artifactFiles}
              />
            )}
          </div>
        </div>

        {/* Right panel — Sidebar */}
        <Sidebar
          task={task}
          currentStatus={currentStatus}
          planData={planData}
          liveUsage={liveUsage}
          verifyResult={verifyResult}
          editingPlan={editingPlan}
          editedCodingPrompt={editedCodingPrompt}
          planTab={planTab}
          onSetEditingPlan={setEditingPlan}
          onSetEditedCodingPrompt={setEditedCodingPrompt}
          onSetPlanTab={setPlanTab}
          onApprovePlan={handleApprovePlan}
          onRejectPlan={handleRejectPlan}
          interviewQuestions={interviewQuestions}
          interviewAnswers={interviewAnswers}
          submittingAnswers={submittingAnswers}
          onSetInterviewAnswers={setInterviewAnswers}
          onSubmitInterview={handleSubmitInterview}
          onSkipInterview={handleSkipInterview}
          attempts={task.attempts ?? []}
          projectTasks={projectTasks}
          parsedResult={parsedResult}
          escalationReport={escalationReport}
        />
      </div>
    </div>
  );
}
