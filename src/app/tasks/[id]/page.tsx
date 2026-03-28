'use client';
import { useState, useEffect, use } from 'react';
import Link from 'next/link';

interface TaskDetail {
  id: string;
  prompt: string;
  status: string;
  projectDir: string | null;
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

const STAGES = ['pending', 'planning', 'coding', 'verifying', 'completed'];

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
              {stage}
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

  useEffect(() => {
    fetch(`/api/tasks/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setTask(data);
        setCurrentStatus(data.status);
      });
  }, [id]);

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
      if (event.type === 'attempt_start') {
        setAttemptCount(event.attemptNum);
      }
    };
    return () => es.close();
  }, [id]);

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
        <p className="text-gray-500 text-sm mb-4">Project: {task.projectDir}</p>
      )}

      {attemptCount > 1 && (
        <p className="text-sm text-yellow-400 mb-2">
          Attempt {attemptCount} of 3
        </p>
      )}

      <StageIndicator currentStatus={currentStatus} />

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
                {!['status_change', 'log', 'task_complete', 'attempt_start', 'attempt_complete'].includes(event.type) && (
                  <span className="text-gray-400">[{event.type}] {JSON.stringify(event)}</span>
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

      {escalationReport && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3 text-red-400">Escalation Report</h2>
          <div className="bg-red-950/30 rounded-lg border border-red-900/50 p-4">
            <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">{escalationReport}</pre>
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
