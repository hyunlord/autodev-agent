'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { CostBreakdown } from './CostBreakdown';
import { planToMermaid } from '@/lib/utils/plan-to-mermaid';

const MermaidDiagram = dynamic(() => import('./MermaidDiagram'), {
  ssr: false,
  loading: () => <div className="text-gray-600 text-sm p-4">Loading diagram...</div>,
});
import type { TaskDetail, PlanData, LiveUsage, CycleInfo } from './types';

interface Props {
  task: TaskDetail;
  currentStatus: string;
  planData: PlanData | null;
  liveUsage: LiveUsage;
  // Plan review
  editingPlan: boolean;
  editedCodingPrompt: string;
  planTab: 'json' | 'diagram';
  onSetEditingPlan: (v: boolean) => void;
  onSetEditedCodingPrompt: (v: string) => void;
  onSetPlanTab: (v: 'json' | 'diagram') => void;
  onApprovePlan: (edited?: boolean) => void;
  onRejectPlan: () => void;
  // Interview
  interviewQuestions: string[];
  interviewAnswers: Record<number, string>;
  submittingAnswers: boolean;
  onSetInterviewAnswers: (v: Record<number, string>) => void;
  onSubmitInterview: (answers: Record<number, string>) => void;
  onSkipInterview: () => void;
  // Attempts
  attempts: any[];
  // Project history
  projectTasks: Array<{ id: string; prompt: string; status: string; createdAt: string }>;
  // Result
  parsedResult: any;
  // Escalation
  escalationReport: string | null;
}

export function Sidebar({
  task, currentStatus, planData, liveUsage,
  editingPlan, editedCodingPrompt, planTab,
  onSetEditingPlan, onSetEditedCodingPrompt, onSetPlanTab,
  onApprovePlan, onRejectPlan,
  interviewQuestions, interviewAnswers, submittingAnswers,
  onSetInterviewAnswers, onSubmitInterview, onSkipInterview,
  attempts, projectTasks, parsedResult, escalationReport,
}: Props) {
  const router = useRouter();
  const taskConfig = (() => {
    try {
      return typeof task.config === 'string' ? JSON.parse(task.config) : task.config;
    } catch { return null; }
  })();

  return (
    <div className="bg-gray-900 flex flex-col h-full overflow-y-auto">
      {/* Task 정보 */}
      <section className="p-4 border-b border-gray-800">
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Task</h3>
        <p className="text-xs text-gray-300 leading-relaxed">{task.prompt}</p>
        {task.projectDir && (
          <div className="mt-2 flex items-center gap-2">
            <code className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded truncate flex-1">
              {task.projectDir}
            </code>
            <button
              onClick={async () => {
                await fetch('/api/workspace/open', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ path: task.projectDir }),
                });
              }}
              className="text-[10px] px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded transition-colors flex-shrink-0"
            >
              Open
            </button>
          </div>
        )}
      </section>

      {/* Interview — active */}
      {currentStatus === 'interview' && interviewQuestions.length > 0 && (
        <section className="p-4 border-b border-teal-800/50 bg-teal-950/10">
          <h3 className="text-xs text-teal-400 uppercase tracking-wider mb-2">Interview</h3>
          <div className="space-y-2.5">
            {interviewQuestions.map((q, i) => (
              <div key={i}>
                <p className="text-[10px] text-gray-400 mb-1">{i + 1}. {q}</p>
                <input
                  type="text"
                  value={interviewAnswers[i] ?? ''}
                  onChange={e => onSetInterviewAnswers({ ...interviewAnswers, [i]: e.target.value })}
                  placeholder="Answer..."
                  className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-teal-600"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => onSubmitInterview(interviewAnswers)}
              disabled={submittingAnswers || Object.keys(interviewAnswers).length === 0}
              className="flex-1 py-1.5 text-xs bg-teal-600 hover:bg-teal-500 text-white rounded disabled:opacity-50 transition-colors"
            >
              {submittingAnswers ? 'Submitting...' : 'Submit'}
            </button>
            <button
              onClick={onSkipInterview}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Skip
            </button>
          </div>
        </section>
      )}

      {/* Interview — recorded */}
      {(() => {
        const questions = taskConfig?.interviewQuestions as string[] | undefined;
        const answers = taskConfig?.interviewAnswers;
        if (!questions || questions.length === 0) return null;
        return (
          <section className="p-4 border-b border-gray-800">
            <h3 className="text-xs text-amber-400 uppercase tracking-wider mb-2">Interview Q&A</h3>
            <div className="space-y-1.5">
              {questions.map((q: string, i: number) => (
                <div key={i} className="text-[10px]">
                  <p className="text-gray-500">Q: {q}</p>
                  <p className="text-gray-300">A: {answers?.[i] ?? answers?.[String(i)] ?? '(no answer)'}</p>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Plan — review 또는 표시 */}
      {planData && (
        <section className="p-4 border-b border-gray-800">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <h3 className="text-xs text-indigo-400 uppercase tracking-wider">Plan</h3>
              <div className="flex gap-0.5">
                <button
                  onClick={() => onSetPlanTab('json')}
                  className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${planTab === 'json' ? 'bg-indigo-700 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}
                >
                  Detail
                </button>
                <button
                  onClick={() => onSetPlanTab('diagram')}
                  className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${planTab === 'diagram' ? 'bg-indigo-700 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}
                >
                  Diagram
                </button>
              </div>
            </div>
            {currentStatus === 'plan_review' && (
              <div className="flex gap-1">
                <button
                  onClick={() => onSetEditingPlan(!editingPlan)}
                  className="px-2 py-0.5 text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                >
                  {editingPlan ? 'Preview' : 'Edit'}
                </button>
              </div>
            )}
          </div>

          {planTab === 'diagram' && (
            <div className="bg-gray-950 rounded-lg p-3 min-h-24 border border-gray-800">
              <MermaidDiagram chart={planToMermaid(planData)} />
            </div>
          )}

          {planTab === 'json' && (
            <div className="space-y-2.5">
              <div>
                <p className="text-[10px] text-gray-600 mb-0.5">Summary</p>
                <p className="text-xs text-gray-300">{planData.summary}</p>
              </div>

              {(planData.taskCategory || planData.agentName) && (
                <div className="flex items-center gap-3">
                  {planData.taskCategory && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-indigo-900/30 text-indigo-300 rounded-full">
                      {planData.taskCategory}
                    </span>
                  )}
                  {planData.agentName && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-300 rounded">
                      {planData.autoSelected ? 'AI ' : ''}{planData.agentName}
                    </span>
                  )}
                </div>
              )}

              <div>
                <p className="text-[10px] text-gray-600 mb-0.5">Files</p>
                <div className="flex flex-wrap gap-1">
                  {planData.estimatedFiles.map((f, i) => (
                    <code key={i} className="text-[10px] bg-gray-800 text-gray-400 px-1 py-0.5 rounded">{f}</code>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] text-gray-600 mb-0.5">Coding prompt</p>
                {editingPlan && currentStatus === 'plan_review' ? (
                  <textarea
                    value={editedCodingPrompt}
                    onChange={(e) => onSetEditedCodingPrompt(e.target.value)}
                    rows={8}
                    className="w-full px-2 py-1.5 bg-gray-950 border border-gray-700 rounded text-gray-300 text-[10px] font-mono focus:outline-none focus:border-indigo-500 resize-y"
                  />
                ) : (
                  <pre className="text-[10px] text-gray-400 bg-gray-950 p-2 rounded overflow-x-auto max-h-40 whitespace-pre-wrap font-mono border border-gray-800">{planData.codingPrompt}</pre>
                )}
              </div>

              <div>
                <p className="text-[10px] text-gray-600 mb-0.5">Verification</p>
                <div className="space-y-0.5">
                  {planData.verificationSpec.steps.map((s: any, i: number) => (
                    <div key={i} className="text-[10px] text-gray-500 flex items-center gap-1.5">
                      <span className="text-indigo-400 font-mono">{s.id}</span>
                      <span className="text-gray-700">&middot;</span>
                      <span>{s.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Plan review 버튼 */}
          {currentStatus === 'plan_review' && (
            <div className="flex gap-2 mt-3">
              <button
                onClick={onRejectPlan}
                className="flex-1 py-2 text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 rounded-lg transition-colors"
              >
                Reject
              </button>
              <button
                onClick={() => onApprovePlan(editingPlan)}
                className="flex-1 py-2 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors font-medium"
              >
                Approve & Run
              </button>
            </div>
          )}

          {task.systemPrompt && (
            <div className="mt-2.5 pt-2.5 border-t border-gray-800">
              <p className="text-[10px] text-gray-600 mb-0.5">System prompt</p>
              <pre className="text-[10px] text-gray-500 bg-gray-950 p-2 rounded max-h-20 overflow-y-auto whitespace-pre-wrap font-mono border border-gray-800">
                {task.systemPrompt}
              </pre>
            </div>
          )}
        </section>
      )}

      {/* Configuration */}
      <section className="p-4 border-b border-gray-800">
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Configuration</h3>
        <div className="space-y-1.5 text-xs">
          {([
            ['Planning', (task as any).planningMode ?? 'auto'],
            ['Coding', (task as any).agentId ?? 'auto'],
            ['Mode', (task as any).executionMode ?? 'single'],
            ['Auto-approve', taskConfig?.autoApprove ? 'Yes' : 'No'],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <span className="text-gray-600">{label}</span>
              <span className="text-gray-400">{value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Cost breakdown */}
      <section className="p-4 border-b border-gray-800">
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Cost breakdown</h3>
        <CostBreakdown costs={liveUsage.agentCosts} />
        <div className="mt-2 flex justify-between text-[10px] text-gray-600">
          <span>{(liveUsage.totalInputTokens + liveUsage.totalOutputTokens).toLocaleString()} tokens</span>
          <span>{liveUsage.totalInputTokens.toLocaleString()} in / {liveUsage.totalOutputTokens.toLocaleString()} out</span>
        </div>
      </section>

      {/* Result summary */}
      {['completed', 'failed', 'escalated'].includes(currentStatus) && parsedResult && (
        <section className="p-4 border-b border-gray-800">
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Result</h3>
          <div className="grid grid-cols-2 gap-2">
            {parsedResult.attempts !== undefined && (
              <div className="bg-gray-800/50 rounded-lg p-2.5">
                <p className="text-[10px] text-gray-600">Attempts</p>
                <p className="text-sm font-bold text-gray-200">{parsedResult.attempts}</p>
              </div>
            )}
            {parsedResult.costUsd !== undefined && (
              <div className="bg-gray-800/50 rounded-lg p-2.5">
                <p className="text-[10px] text-gray-600">Cost</p>
                <p className="text-sm font-bold text-gray-200">${Number(parsedResult.costUsd).toFixed(4)}</p>
              </div>
            )}
            {parsedResult.modifiedFiles && (
              <div className="bg-gray-800/50 rounded-lg p-2.5">
                <p className="text-[10px] text-gray-600">Files</p>
                <p className="text-sm font-bold text-gray-200">{parsedResult.modifiedFiles.length}</p>
              </div>
            )}
            {task.updatedAt && task.createdAt && (
              <div className="bg-gray-800/50 rounded-lg p-2.5">
                <p className="text-[10px] text-gray-600">Duration</p>
                <p className="text-sm font-bold text-gray-200">
                  {Math.round((new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime()) / 1000)}s
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Attempts */}
      {attempts.length > 0 && (
        <section className="p-4 border-b border-gray-800">
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Attempts ({attempts.length})</h3>
          <div className="space-y-2">
            {attempts.map((attempt: any, i: number) => (
              <div key={i} className="bg-gray-800/50 rounded-lg p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${attempt.status === 'success' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span className="text-[10px] font-medium text-gray-300">
                      #{attempt.attemptNum} {attempt.agentId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-600">
                    {attempt.costUsd && <span>${Number(attempt.costUsd).toFixed(4)}</span>}
                    {attempt.durationMs && <span>{(attempt.durationMs / 1000).toFixed(1)}s</span>}
                  </div>
                </div>
                {attempt.errorLog && (
                  <pre className="text-[10px] text-red-400 bg-red-950/20 p-1.5 rounded mt-1 max-h-16 overflow-y-auto whitespace-pre-wrap">
                    {attempt.errorLog.slice(0, 300)}
                  </pre>
                )}
                {attempt.verifications && attempt.verifications.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mt-1.5">
                    {attempt.verifications.map((v: any, vi: number) => (
                      <span key={vi} className={`text-[10px] px-1 py-0.5 rounded ${v.status === 'pass' ? 'bg-emerald-900/30 text-emerald-400' : v.status === 'fail' ? 'bg-red-900/30 text-red-400' : 'bg-gray-800 text-gray-600'}`}>
                        {v.status === 'pass' ? '\u2713' : v.status === 'fail' ? '\u2717' : '\u25CB'} {v.checkId}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Project history */}
      {projectTasks.length > 0 && (
        <section className="p-4 border-b border-gray-800">
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">History</h3>
          <div className="space-y-1.5">
            {projectTasks.map((pt) => (
              <Link
                key={pt.id}
                href={`/tasks/${pt.id}`}
                className="block p-2 bg-gray-800/50 rounded hover:bg-gray-800 transition-colors"
              >
                <p className="text-[10px] text-gray-300 truncate">{pt.prompt}</p>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[10px] text-gray-600">{new Date(pt.createdAt).toLocaleDateString()}</span>
                  <span className={`text-[10px] ${pt.status === 'completed' ? 'text-emerald-400' : pt.status === 'failed' ? 'text-red-400' : 'text-gray-500'}`}>
                    {pt.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Continue 버튼 */}
      <section className="p-4 mt-auto">
        {['completed', 'failed'].includes(currentStatus) && (
          <button
            onClick={() => router.push(`/?chain=${task.id}`)}
            className="w-full py-2.5 text-sm font-medium bg-indigo-500/15 text-indigo-400
              border border-indigo-500/30 rounded-lg hover:bg-indigo-500/25 transition-colors"
          >
            Continue this task
          </button>
        )}
      </section>
    </div>
  );
}
