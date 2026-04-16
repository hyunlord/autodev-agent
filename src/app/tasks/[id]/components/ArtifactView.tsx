'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { VlmCard } from './VlmCard';
import { ArtifactPreview } from './ArtifactPreview';
import { ScreenshotCompare } from './ScreenshotCompare';
import { planToMermaid } from '@/lib/utils/plan-to-mermaid';
import type { PlanData, ScreenshotData, VerificationResult } from './types';

const DagView = dynamic(() => import('./DagView'), { ssr: false });
const MermaidDiagram = dynamic(() => import('./MermaidDiagram'), {
  ssr: false,
  loading: () => <div className="text-sm p-4" style={{ color: 'var(--text-secondary)' }}>Loading diagram...</div>,
});

interface Props {
  planData: PlanData | null;
  screenshots: ScreenshotData[];
  verificationResults: VerificationResult[];
  escalationReport: string | null;
  artifactFiles?: Record<string, string>;
}

export function ArtifactView({ planData, screenshots, verificationResults, escalationReport, artifactFiles }: Props) {
  const hasAny = planData || screenshots.length > 0 || escalationReport || (artifactFiles && Object.keys(artifactFiles).length > 0);

  // Screenshot comparison: pair consecutive screenshots by checkId
  const screenshotPairs = screenshots.length >= 2
    ? screenshots.reduce<Array<{ before: ScreenshotData; after: ScreenshotData }>>((pairs, ss, i) => {
        if (i > 0 && screenshots[i - 1].checkId === ss.checkId) {
          pairs.push({ before: screenshots[i - 1], after: ss });
        }
        return pairs;
      }, [])
    : [];

  if (!hasAny) {
    return (
      <div className="flex items-center justify-center h-64 text-sm" style={{ color: 'var(--text-secondary)' }}>
        No artifacts yet. Artifacts appear as the task progresses.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Artifact preview (HTML/CSS/JS) */}
      {artifactFiles && Object.keys(artifactFiles).length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Artifact Preview</h3>
          <ArtifactPreview files={artifactFiles} />
        </section>
      )}

      {/* DAG view (sub-task dependencies) */}
      {planData?.subTasks && planData.subTasks.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Task Dependency Graph</h3>
          <DagView subTasks={planData.subTasks} />
        </section>
      )}

      {/* Plan diagram */}
      {planData && (
        <section>
          <h3 className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Plan Diagram</h3>
          <div className="rounded-lg p-4 border min-h-32" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
            <MermaidDiagram chart={planToMermaid(planData)} />
          </div>
        </section>
      )}

      {/* Screenshot comparisons (Before/After slider) */}
      {screenshotPairs.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
            Screenshot Comparison ({screenshotPairs.length})
          </h3>
          <div className="space-y-3">
            {screenshotPairs.map((pair, i) => (
              <div key={i}>
                <p className="text-[10px] mb-1" style={{ color: 'var(--text-secondary)' }}>{pair.before.checkId}</p>
                <ScreenshotCompare
                  beforeUrl={`/api/screenshots/${encodeURIComponent(pair.before.path)}`}
                  afterUrl={`/api/screenshots/${encodeURIComponent(pair.after.path)}`}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Screenshots */}
      {screenshots.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
            Screenshots ({screenshots.length})
          </h3>
          <div className="grid grid-cols-1 gap-3">
            {screenshots.map((ss, i) => (
              <div key={i} className="rounded-lg overflow-hidden border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                <div className="px-3 py-1.5 text-xs border-b" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }}>
                  {ss.checkId}
                </div>
                <img
                  src={`/api/screenshots/${encodeURIComponent(ss.path)}`}
                  alt={`Screenshot for ${ss.checkId}`}
                  className="w-full max-h-80 object-contain"
                  style={{ background: 'var(--bg-primary)' }}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Verification summary */}
      {verificationResults.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Verification Results</h3>
          <div className="space-y-1.5">
            {verificationResults.map((vr, i) => (
              <div key={i} className="flex items-start gap-2.5 p-2 rounded-lg border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                <span className={`mt-0.5 text-sm flex-shrink-0 ${vr.status === 'pass' ? 'text-emerald-400' : vr.status === 'fail' ? 'text-red-400' : ''}`} style={vr.status !== 'pass' && vr.status !== 'fail' ? { color: 'var(--text-secondary)' } : undefined}>
                  {vr.status === 'pass' ? '\u2713' : vr.status === 'fail' ? '\u2717' : '\u25CB'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{vr.detail}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{vr.checkId}</p>
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
            <pre className="text-xs whitespace-pre-wrap font-mono" style={{ color: 'var(--text-primary)' }}>{escalationReport}</pre>
          </div>
        </section>
      )}
    </div>
  );
}
