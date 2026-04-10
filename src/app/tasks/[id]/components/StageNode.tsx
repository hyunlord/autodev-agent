'use client';

import { type PlanData } from './types';
import { VlmCard } from './VlmCard';

interface VerifyData {
  passedChecks: number;
  totalChecks: number;
  score?: number;
  designScore?: number;
  vlmDetails?: Array<{ label: string; score: number; max: number }>;
  vlmIssues?: string[];
  vlmModel?: string;
  screenshotUrl?: string;
}

interface Props {
  stage: string;
  status: 'done' | 'active' | 'pending';
  duration?: string;
  agentId?: string;
  isLast?: boolean;
  // Planning
  planData?: PlanData | null;
  planCost?: number;
  // Coding
  codingSummary?: string;
  addedLines?: number;
  codingCost?: number;
  // Verify
  verifyData?: VerifyData;
}

const stageLabels: Record<string, string> = {
  pending: 'Pending',
  planning: 'Planning',
  plan_review: 'Plan Review',
  coding: 'Coding',
  verifying: 'Verification',
  completed: 'Completed',
  failed: 'Failed',
  escalated: 'Escalated',
  retrying: 'Retrying',
};

function getStageColor(status: 'done' | 'active' | 'pending', stage: string): string {
  if (stage === 'failed' || stage === 'escalated') return 'bg-red-500';
  if (status === 'done') return 'bg-emerald-500';
  if (status === 'active') return 'bg-indigo-500 animate-pulse';
  return 'bg-gray-700';
}

export function StageNode({
  stage, status, duration, agentId, isLast,
  planData, planCost,
  codingSummary, addedLines, codingCost,
  verifyData,
}: Props) {
  return (
    <div className="flex gap-4">
      {/* 좌측: 점 + 선 */}
      <div className="flex flex-col items-center w-7 flex-shrink-0">
        <div className={`w-3 h-3 rounded-full border-2 border-gray-950 ${getStageColor(status, stage)}`} />
        {!isLast && <div className="w-0.5 flex-1 bg-gray-800" />}
      </div>

      {/* 우측: 카드 */}
      <div className="flex-1 pb-6 min-w-0">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-sm font-medium text-gray-200">{stageLabels[stage] ?? stage}</span>
          {duration && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">{duration}</span>
          )}
          {agentId && <span className="text-xs text-gray-600">{agentId}</span>}
        </div>

        {/* Planning 카드 */}
        {stage === 'planning' && planData && (
          <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
            <p className="text-xs text-gray-400 mb-2">{planData.summary}</p>
            <div className="flex gap-2 flex-wrap">
              {planData.estimatedFiles?.slice(0, 5).map(f => (
                <span key={f} className="text-xs px-2 py-0.5 bg-gray-800 text-gray-400 rounded font-mono">{f}</span>
              ))}
              {planData.estimatedFiles?.length > 5 && (
                <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-500 rounded">
                  +{planData.estimatedFiles.length - 5} more
                </span>
              )}
              {planCost != null && planCost > 0 && (
                <span className="text-xs px-2 py-0.5 bg-violet-500/15 text-violet-400 rounded">
                  ${planCost.toFixed(4)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Coding 카드 */}
        {stage === 'coding' && (codingSummary || addedLines != null) && (
          <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
            {codingSummary && <p className="text-xs text-gray-400 mb-2">{codingSummary}</p>}
            <div className="flex gap-2">
              {addedLines != null && (
                <span className="text-xs px-2 py-0.5 bg-emerald-500/15 text-emerald-400 rounded">
                  +{addedLines} lines
                </span>
              )}
              {codingCost != null && codingCost > 0 && (
                <span className="text-xs px-2 py-0.5 bg-violet-500/15 text-violet-400 rounded">
                  ${codingCost.toFixed(4)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Verify 카드 */}
        {stage === 'verifying' && verifyData && (
          <>
            <div className="grid grid-cols-2 gap-2.5 mb-2.5">
              <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
                <p className="text-xs text-gray-600 mb-1">Mechanical checks</p>
                <span className={`text-sm font-medium ${verifyData.passedChecks === verifyData.totalChecks ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {verifyData.passedChecks}/{verifyData.totalChecks}
                </span>
              </div>
              {verifyData.score != null && (
                <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
                  <p className="text-xs text-gray-600 mb-1">LLM verdict</p>
                  <span className={`text-sm font-medium ${verifyData.score >= 70 ? 'text-emerald-400' : verifyData.score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                    {verifyData.score}/100
                  </span>
                </div>
              )}
            </div>

            {verifyData.designScore != null && (
              <VlmCard
                score={verifyData.designScore}
                details={verifyData.vlmDetails}
                issues={verifyData.vlmIssues}
                vlmModel={verifyData.vlmModel}
              />
            )}

            {verifyData.screenshotUrl && (
              <div className="bg-gray-900 rounded-lg overflow-hidden border border-gray-800 mt-2.5">
                <div className="px-3 py-1.5 text-xs text-gray-600 border-b border-gray-800">Screenshot</div>
                <img src={verifyData.screenshotUrl} alt="Screenshot" className="w-full max-h-48 object-contain bg-gray-950" />
              </div>
            )}
          </>
        )}

        {/* Completed */}
        {stage === 'completed' && status === 'done' && (
          <div className="bg-emerald-950/20 rounded-lg p-3 border border-emerald-800/30">
            <span className="text-xs text-emerald-400">Task completed successfully</span>
          </div>
        )}

        {/* Failed */}
        {(stage === 'failed' || stage === 'escalated') && (
          <div className="bg-red-950/20 rounded-lg p-3 border border-red-800/30">
            <span className="text-xs text-red-400">
              {stage === 'escalated' ? 'Task escalated — see report' : 'Task failed'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
