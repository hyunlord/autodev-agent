'use client';
import { useState, useEffect, use } from 'react';
import Link from 'next/link';

interface TaskDetail {
  id: string;
  prompt: string;
  status: string;
  projectDir: string | null;
  result?: string | object;
  createdAt: string;
  updatedAt: string;
  attempts: any[];
  events: any[];
}

interface PipelineEvent {
  type: string;
  status?: string;
  message?: string;
  success?: boolean;
  summary?: string;
  level?: string;
  [key: string]: any;
}

const STAGES = ['pending', 'planning', 'plan_review', 'coding', 'verifying', 'completed'];

function StageIndicator({ currentStatus }: { currentStatus: string }) {
  const currentIdx = STAGES.indexOf(currentStatus);
  const isFailed = currentStatus === 'failed' || currentStatus === 'escalated';

  return (
    <div className="flex items-center gap-2 mb-6">
      {STAGES.map((stage, i) => {
        let color = 'bg-gray-700 text-gray-500';
        if (isFailed && i === currentIdx) {
          color = 'bg-red-900 text-red-300';
        } else if (i < currentIdx || currentStatus === 'completed') {
          color = 'bg-green-900 text-green-300';
        } else if (i === currentIdx) {
          color = 'bg-indigo-900 text-indigo-300';
        }

        return (
          <div key={stage} className="flex items-center gap-2">
            {i > 0 && <div className={`w-8 h-0.5 ${i <= currentIdx ? 'bg-green-700' : 'bg-gray-700'}`} />}
            <span className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${color}`}>
              {stage === 'plan_review' ? 'review' : stage}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [liveEvents, setLiveEvents] = useState<PipelineEvent[]>([]);
  const [screenshots, setScreenshots] = useState<Array<{ path: string; checkId: string }>>([]);
  const [currentStatus, setCurrentStatus] = useState('pending');
  const [verificationResults, setVerificationResults] = useState<Array<{ checkId: string; status: string; detail: string }>>([]);
  const [escalationReport, setEscalationReport] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(1);
  const [planData, setPlanData] = useState<{
    summary: string;
    codingPrompt: string;
    estimatedFiles: string[];
    verificationSpec: { steps: Array<{ id: string; type: string; description: string; [key: string]: any }> };
    taskCategory?: string;
    agentName?: string;
    agentId?: string;
    autoSelected?: boolean;
  } | null>(null);
  const [editingPlan, setEditingPlan] = useState(false);
  const [editedCodingPrompt, setEditedCodingPrompt] = useState('');
  const [previewFile, setPreviewFile] = useState<{ path: string; content: string; language: string } | null>(null);
  const [projectTasks, setProjectTasks] = useState<Array<{ id: string; prompt: string; status: string; createdAt: string }>>([]);
  const [cycleInfo, setCycleInfo] = useState<{ current: number; max: number; steps: string[] }>({ current: 0, max: 0, steps: [] });
  const [liveUsage, setLiveUsage] = useState<{
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    agentCosts: Record<string, number>;
  }>({ totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, agentCosts: {} });

  useEffect(() => {
    window.scrollTo(0, 0);

    fetch(`/api/tasks/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setTask(data);
        setCurrentStatus(data.status);

        // Hydrate cycle info from DB
        if (data.maxCycles > 1) {
          setCycleInfo(prev => ({ ...prev, current: data.cycleCount ?? 0, max: data.maxCycles ?? 0 }));
        }

        // Hydrate plan from DB
        if (data.plan) {
          const plan = typeof data.plan === 'string' ? JSON.parse(data.plan) : data.plan;
          setPlanData(plan);
          setEditedCodingPrompt(plan.codingPrompt ?? '');
        }

        // Hydrate events from DB (each has { type, data, createdAt } where data is JSON string)
        if (data.events && Array.isArray(data.events) && data.events.length > 0) {
          const storedEvents: PipelineEvent[] = [];
          const storedVerifications: Array<{ checkId: string; status: string; detail: string }> = [];
          const storedScreenshots: Array<{ path: string; checkId: string }> = [];
          let storedEscalation: string | null = null;
          let maxAttempt = 1;
          const storedUsage = { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, agentCosts: {} as Record<string, number> };

          for (const evt of data.events) {
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
        }
      });
  }, [id]);

  useEffect(() => {
    if (task?.projectDir) {
      fetch(`/api/tasks?projectDir=${encodeURIComponent(task.projectDir)}&limit=10`)
        .then(r => r.json())
        .then(data => setProjectTasks(data.filter((t: any) => t.id !== id)))
        .catch(() => {});
    }
  }, [task?.projectDir, id]);

  useEffect(() => {
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
  }, [id]);

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

  const parsedResult = task?.result
    ? (() => { try { return typeof task.result === 'string' ? JSON.parse(task.result) : task.result; } catch { return null; } })()
    : null;

  if (!task) {
    return (
      <div className="min-h-screen p-8 max-w-4xl mx-auto">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 max-w-4xl mx-auto">
      <Link href="/" className="text-indigo-400 hover:text-indigo-300 text-sm mb-4 inline-block">
        &larr; Back to Dashboard
      </Link>

      <h1 className="text-2xl font-bold mb-2">Task Detail</h1>
      <p className="text-gray-300 mb-4">{task.prompt}</p>

      {task.projectDir && (
        <div className="flex items-center gap-2 mb-4">
          <code className="text-sm text-gray-400 bg-gray-800 px-2 py-1 rounded">{task.projectDir}</code>
          <button
            onClick={async () => {
              await fetch('/api/workspace/open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: task.projectDir }),
              });
            }}
            className="px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
          >
            📂 Open Folder
          </button>
        </div>
      )}

      {attemptCount > 1 && (
        <p className="text-sm text-yellow-400 mb-2">
          Attempt {attemptCount} of 3
        </p>
      )}

      <StageIndicator currentStatus={currentStatus} />

      {(liveUsage.totalCostUsd > 0 || currentStatus === 'coding') && (
        <div className="mb-4 flex items-center gap-4 px-3 py-2 bg-gray-900/50 rounded-lg border border-gray-800 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">Cost:</span>
            <span className="text-gray-200 font-medium">${liveUsage.totalCostUsd.toFixed(4)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">Tokens:</span>
            <span className="text-gray-200">
              {(liveUsage.totalInputTokens + liveUsage.totalOutputTokens).toLocaleString()}
            </span>
            <span className="text-gray-600 text-[10px]">
              ({liveUsage.totalInputTokens.toLocaleString()} in / {liveUsage.totalOutputTokens.toLocaleString()} out)
            </span>
          </div>
          {Object.keys(liveUsage.agentCosts).length > 1 && (
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">By agent:</span>
              {Object.entries(liveUsage.agentCosts).map(([aid, cost]) => (
                <span key={aid} className="text-gray-400">
                  {aid}: ${(cost as number).toFixed(4)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {cycleInfo.max > 1 && (
        <div className="mb-4 p-3 bg-amber-950/20 rounded-lg border border-amber-800/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-amber-400 font-medium">
              Auto-cycle: {cycleInfo.current}/{cycleInfo.max}
            </span>
            {currentStatus !== 'completed' && currentStatus !== 'failed' && (
              <button
                onClick={async () => {
                  await fetch(`/api/tasks/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'stop' }),
                  });
                }}
                className="px-2 py-1 text-xs bg-red-900/50 hover:bg-red-900 text-red-300 rounded transition-colors"
              >
                Stop
              </button>
            )}
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5 mb-2">
            <div
              className="bg-amber-500 h-1.5 rounded-full transition-all"
              style={{ width: `${(cycleInfo.current / cycleInfo.max) * 100}%` }}
            />
          </div>
          {cycleInfo.steps.length > 0 && (
            <div className="space-y-1 mt-2">
              {cycleInfo.steps.map((step, i) => (
                <p key={i} className="text-xs text-gray-400">{step}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {planData && (
        <section className="mb-6 p-5 bg-indigo-950/20 rounded-lg border border-indigo-800/50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-indigo-300">
              {currentStatus === 'plan_review' ? 'Plan Review' : 'Plan'}
            </h2>
            {currentStatus === 'plan_review' && (
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingPlan(!editingPlan)}
                  className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
                >
                  {editingPlan ? 'Preview' : 'Edit'}
                </button>
                <button
                  onClick={async () => {
                    await fetch(`/api/tasks/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'reject' }),
                    });
                    setCurrentStatus('failed');
                  }}
                  className="px-3 py-1.5 text-xs bg-red-900/50 hover:bg-red-900 text-red-300 rounded-lg transition-colors"
                >
                  Reject
                </button>
                <button
                  onClick={async () => {
                    const planToSend = editingPlan ? {
                      ...planData,
                      codingPrompt: editedCodingPrompt,
                    } : undefined;
                    await fetch(`/api/tasks/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'approve', plan: planToSend }),
                    });
                  }}
                  className="px-4 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-lg transition-colors font-medium"
                >
                  Approve &amp; Run
                </button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">Summary</p>
              <p className="text-sm text-gray-200">{planData.summary}</p>
            </div>

            {(planData.taskCategory || planData.agentName) && (
              <div className="flex items-center gap-4">
                {planData.taskCategory && (
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Category</p>
                    <span className="text-xs px-2 py-0.5 bg-indigo-900/30 text-indigo-300 rounded-full">
                      {planData.taskCategory}
                    </span>
                  </div>
                )}
                {planData.agentName && (
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Agent</p>
                    <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-300 rounded">
                      {planData.autoSelected ? '🤖 ' : ''}{planData.agentName}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div>
              <p className="text-xs text-gray-500 mb-1">Estimated files</p>
              <div className="flex flex-wrap gap-1">
                {planData.estimatedFiles.map((f, i) => (
                  <code key={i} className="text-xs bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded">{f}</code>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-1">Coding prompt</p>
              {editingPlan && currentStatus === 'plan_review' ? (
                <textarea
                  value={editedCodingPrompt}
                  onChange={(e) => setEditedCodingPrompt(e.target.value)}
                  rows={12}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-300 text-xs font-mono focus:outline-none focus:border-indigo-500 resize-y"
                />
              ) : (
                <pre className="text-xs text-gray-300 bg-gray-900 p-3 rounded-lg overflow-x-auto max-h-64 whitespace-pre-wrap font-mono">{planData.codingPrompt}</pre>
              )}
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-1">Verification steps</p>
              <div className="space-y-1">
                {planData.verificationSpec.steps.map((s: any, i: number) => (
                  <div key={i} className="text-xs text-gray-400 bg-gray-900 px-2 py-1.5 rounded flex items-center gap-2">
                    <span className="text-indigo-400 font-mono">{s.id}</span>
                    <span className="text-gray-600">&middot;</span>
                    <span className="text-gray-500">{s.type}</span>
                    <span className="text-gray-600">&middot;</span>
                    <span className="text-gray-300">{s.description}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {(task as any).systemPrompt && (
            <div className="mt-3 pt-3 border-t border-gray-800">
              <p className="text-xs text-gray-500 mb-1">System prompt</p>
              <pre className="text-xs text-gray-400 bg-gray-900 p-2 rounded max-h-24 overflow-y-auto whitespace-pre-wrap font-mono">
                {(task as any).systemPrompt}
              </pre>
            </div>
          )}
        </section>
      )}

      {(currentStatus === 'completed' || currentStatus === 'failed' || currentStatus === 'escalated') && task.result && (
        <div className={`mb-6 p-4 rounded-lg border ${
          currentStatus === 'completed'
            ? 'bg-green-950/20 border-green-900/50'
            : 'bg-red-950/20 border-red-900/50'
        }`}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">{currentStatus === 'completed' ? '✅' : '❌'}</span>
            <div>
              <h3 className="font-semibold text-gray-100">
                {currentStatus === 'completed' ? 'Task Completed' : currentStatus === 'escalated' ? 'Task Escalated' : 'Task Failed'}
              </h3>
              <p className="text-sm text-gray-400">{parsedResult?.summary ?? ''}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {parsedResult?.attempts !== undefined && (
              <div className="bg-gray-900/50 rounded-lg p-3">
                <p className="text-xs text-gray-500">Attempts</p>
                <p className="text-lg font-bold text-gray-200">{parsedResult.attempts}</p>
              </div>
            )}
            {parsedResult?.costUsd !== undefined && (
              <div className="bg-gray-900/50 rounded-lg p-3">
                <p className="text-xs text-gray-500">Cost</p>
                <p className="text-lg font-bold text-gray-200">${Number(parsedResult.costUsd).toFixed(4)}</p>
              </div>
            )}
            {parsedResult?.modifiedFiles && (
              <div className="bg-gray-900/50 rounded-lg p-3">
                <p className="text-xs text-gray-500">Files Modified</p>
                <p className="text-lg font-bold text-gray-200">{parsedResult.modifiedFiles.length}</p>
              </div>
            )}
            {task.updatedAt && task.createdAt && (
              <div className="bg-gray-900/50 rounded-lg p-3">
                <p className="text-xs text-gray-500">Duration</p>
                <p className="text-lg font-bold text-gray-200">
                  {Math.round((new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime()) / 1000)}s
                </p>
              </div>
            )}
          </div>
          {parsedResult?.modifiedFiles?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-800">
              <p className="text-xs text-gray-500 mb-2">Modified Files</p>
              <div className="space-y-1">
                {parsedResult.modifiedFiles.map((f: string, i: number) => (
                  <button
                    key={i}
                    onClick={() => loadFilePreview(f)}
                    className={`block w-full text-left text-xs px-2 py-1.5 rounded transition-colors ${
                      previewFile?.path === f
                        ? 'bg-indigo-900/30 text-indigo-300 border border-indigo-800'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    📄 {f}
                  </button>
                ))}
              </div>
              {previewFile && (
                <div className="mt-3 rounded-lg border border-gray-700 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
                    <span className="text-xs text-gray-400">{previewFile.path}</span>
                    <span className="text-xs text-gray-600">{previewFile.language}</span>
                  </div>
                  <pre className="p-3 text-xs text-gray-300 overflow-x-auto max-h-96 bg-gray-950">
                    <code>{previewFile.content}</code>
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Live Events</h2>
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 max-h-96 overflow-y-auto space-y-2">
          {liveEvents.length === 0 ? (
            <p className="text-gray-500 text-sm">Waiting for events...</p>
          ) : (
            liveEvents.map((event, i) => (
              <div key={i} className="text-sm font-mono">
                {event.type === 'status_change' && (
                  <span className="text-blue-400">[{event.status}] {event.message}</span>
                )}
                {event.type === 'log' && (
                  <span className={event.level === 'error' ? 'text-red-400' : event.level === 'warn' ? 'text-yellow-400' : 'text-gray-400'}>
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
                  <span className={event.status === 'pass' ? 'text-green-400' : event.status === 'fail' ? 'text-red-400' : 'text-gray-500'}>
                    [{event.status === 'pass' ? '✓' : event.status === 'fail' ? '✗' : '○'}] {event.detail}
                  </span>
                )}
                {event.type === 'screenshot' && (
                  <span className="text-cyan-400">
                    [📸] Screenshot captured for {event.checkId}
                  </span>
                )}
                {event.type === 'escalation' && (
                  <span className="text-red-400">
                    [⚠] Task escalated — see report below
                  </span>
                )}
                {event.type === 'cycle_start' && (
                  <span className="text-amber-400">
                    [cycle] Starting cycle {event.cycleNum}/{event.totalCycles}
                  </span>
                )}
                {event.type === 'cycle_complete' && (
                  <span className={event.success ? 'text-green-400' : 'text-yellow-400'}>
                    [cycle] Cycle {event.cycleNum} {event.success ? 'completed' : 'failed'}: {event.summary}
                  </span>
                )}
                {event.type === 'auto_cycle_complete' && (
                  <span className="text-amber-300">
                    [auto-cycle] {event.summary}
                  </span>
                )}
                {event.type === 'cost_update' && (
                  <span className="text-emerald-400">
                    [💰] ${((event as any).costUsd ?? 0).toFixed(4)} (total: ${((event as any).totalCostUsd ?? 0).toFixed(4)}) — {(event as any).agentId}
                  </span>
                )}
                {!['status_change', 'log', 'task_complete', 'attempt_start', 'attempt_complete', 'verification_result', 'screenshot', 'escalation', 'cycle_start', 'cycle_complete', 'auto_cycle_complete', 'cost_update'].includes(event.type) && (
                  <span className="text-gray-500">[{event.type}] {JSON.stringify(event)}</span>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Verification Results</h2>
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 space-y-2">
          {verificationResults.length === 0 ? (
            <p className="text-gray-500 text-sm">No verification results yet.</p>
          ) : (
            verificationResults.map((vr, i) => (
              <div key={i} className="flex items-start gap-3 p-2 rounded-lg bg-gray-800/50">
                <span className={`mt-0.5 text-sm ${vr.status === 'pass' ? 'text-green-400' : vr.status === 'fail' ? 'text-red-400' : 'text-gray-500'}`}>
                  {vr.status === 'pass' ? '\u2713' : vr.status === 'fail' ? '\u2717' : '\u25CB'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200">{vr.detail}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{vr.checkId}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {task.attempts && task.attempts.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Attempts ({task.attempts.length})</h2>
          <div className="space-y-3">
            {task.attempts.map((attempt: any, i: number) => (
              <div key={i} className="bg-gray-900 rounded-lg border border-gray-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${attempt.status === 'success' ? 'bg-green-400' : 'bg-red-400'}`} />
                    <span className="text-sm font-medium text-gray-200">
                      Attempt #{attempt.attemptNum} — {attempt.agentId}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${attempt.status === 'success' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                      {attempt.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {attempt.costUsd && <span>${Number(attempt.costUsd).toFixed(4)}</span>}
                    {attempt.durationMs && <span>{(attempt.durationMs / 1000).toFixed(1)}s</span>}
                    {attempt.tokenCount && <span>{attempt.tokenCount.toLocaleString()} tokens</span>}
                  </div>
                </div>
                {attempt.errorLog && (
                  <pre className="text-xs text-red-400 bg-red-950/20 p-2 rounded mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap">
                    {attempt.errorLog.slice(0, 500)}
                  </pre>
                )}
                {attempt.verifications && attempt.verifications.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-800">
                    <p className="text-xs text-gray-500 mb-1">Verification ({attempt.verifications.filter((v: any) => v.status === 'pass').length}/{attempt.verifications.length} passed)</p>
                    <div className="flex flex-wrap gap-1">
                      {attempt.verifications.map((v: any, vi: number) => (
                        <span key={vi} className={`text-xs px-1.5 py-0.5 rounded ${v.status === 'pass' ? 'bg-green-900/30 text-green-400' : v.status === 'fail' ? 'bg-red-900/30 text-red-400' : 'bg-gray-800 text-gray-500'}`}>
                          {v.status === 'pass' ? '✓' : v.status === 'fail' ? '✗' : '○'} {v.checkId}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {escalationReport && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3 text-red-400">Escalation Report</h2>
          <div className="bg-red-950/30 rounded-lg border border-red-900/50 p-4">
            <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">{escalationReport}</pre>
          </div>
        </section>
      )}

      {projectTasks.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Project History</h2>
          <div className="space-y-2">
            {projectTasks.map((pt) => (
              <Link
                key={pt.id}
                href={`/tasks/${pt.id}`}
                className="block p-3 bg-gray-900 rounded-lg border border-gray-800 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-300 truncate flex-1 mr-3">{pt.prompt}</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    pt.status === 'completed' ? 'bg-green-900 text-green-300' :
                    pt.status === 'failed' ? 'bg-red-900 text-red-300' :
                    'bg-gray-700 text-gray-300'
                  }`}>
                    {pt.status}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{new Date(pt.createdAt).toLocaleString()}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">Screenshots</h2>
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          {screenshots.length === 0 ? (
            <p className="text-gray-500 text-sm">No screenshots captured yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {screenshots.map((ss, i) => (
                <div key={i} className="space-y-1">
                  <p className="text-xs text-gray-400">Check: {ss.checkId}</p>
                  <img
                    src={`/api/screenshots/${encodeURIComponent(ss.path)}`}
                    alt={`Screenshot for ${ss.checkId}`}
                    className="w-full rounded-lg border border-gray-700"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
