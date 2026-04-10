'use client';

import { MermaidDiagram } from './MermaidDiagram';
import { VlmCard } from './VlmCard';
import { planToMermaid } from '@/lib/utils/plan-to-mermaid';
import type { PlanData, ScreenshotData, VerificationResult } from './types';

interface Props {
  planData: PlanData | null;
  screenshots: ScreenshotData[];
  verificationResults: VerificationResult[];
  escalationReport: string | null;
}

export function ArtifactView({ planData, screenshots, verificationResults, escalationReport }: Props) {
  const hasAny = planData || screenshots.length > 0 || escalationReport;

  if (!hasAny) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
        No artifacts yet. Artifacts appear as the task progresses.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Plan diagram */}
      {planData && (
        <section>
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Plan Diagram</h3>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 min-h-32">
            <MermaidDiagram chart={planToMermaid(planData)} />
          </div>
        </section>
      )}

      {/* Screenshots */}
      {screenshots.length > 0 && (
        <section>
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
            Screenshots ({screenshots.length})
          </h3>
          <div className="grid grid-cols-1 gap-3">
            {screenshots.map((ss, i) => (
              <div key={i} className="bg-gray-900 rounded-lg overflow-hidden border border-gray-800">
                <div className="px-3 py-1.5 text-xs text-gray-600 border-b border-gray-800">
                  {ss.checkId}
                </div>
                <img
                  src={`/api/screenshots/${encodeURIComponent(ss.path)}`}
                  alt={`Screenshot for ${ss.checkId}`}
                  className="w-full max-h-80 object-contain bg-gray-950"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Verification summary */}
      {verificationResults.length > 0 && (
        <section>
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Verification Results</h3>
          <div className="space-y-1.5">
            {verificationResults.map((vr, i) => (
              <div key={i} className="flex items-start gap-2.5 p-2 rounded-lg bg-gray-900 border border-gray-800">
                <span className={`mt-0.5 text-sm flex-shrink-0 ${vr.status === 'pass' ? 'text-emerald-400' : vr.status === 'fail' ? 'text-red-400' : 'text-gray-600'}`}>
                  {vr.status === 'pass' ? '\u2713' : vr.status === 'fail' ? '\u2717' : '\u25CB'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-300">{vr.detail}</p>
                  <p className="text-[10px] text-gray-600 mt-0.5">{vr.checkId}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Escalation report */}
      {escalationReport && (
        <section>
          <h3 className="text-xs text-red-400 uppercase tracking-wider mb-2">Escalation Report</h3>
          <div className="bg-red-950/20 rounded-lg border border-red-900/50 p-4">
            <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono">{escalationReport}</pre>
          </div>
        </section>
      )}
    </div>
  );
}
