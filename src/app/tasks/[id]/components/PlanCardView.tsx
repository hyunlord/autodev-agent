'use client';

import type { PlanData, SubTaskNode } from './types';

interface PlanCardViewProps {
  plan: PlanData;
}

export function PlanCardView({ plan }: PlanCardViewProps) {
  const subTasks = plan.subTasks ?? [];

  return (
    <div className="space-y-2">
      {/* Summary */}
      <div className="p-2.5 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
        <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{plan.summary}</p>
      </div>

      {/* Sub-tasks */}
      {subTasks.length > 0 && (
        <div className="space-y-1.5">
          {subTasks.map((st: SubTaskNode, i: number) => {
            const status = st.status ?? 'pending';
            return (
              <div
                key={st.id}
                className={`p-2.5 rounded-lg border-l-[3px] transition-all ${
                  status === 'running' ? 'border-l-blue-500 bg-blue-500/5' :
                  status === 'done' ? 'border-l-emerald-500 bg-emerald-500/5' :
                  status === 'failed' ? 'border-l-red-500 bg-red-500/5' :
                  ''
                }`}
                style={status === 'pending' ? { borderLeftColor: 'var(--border-color)', background: 'var(--bg-secondary)' } : undefined}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0 ${
                      status === 'done' ? 'bg-emerald-500/20 text-emerald-400' :
                      status === 'running' ? 'bg-blue-500/20 text-blue-400 animate-pulse' :
                      status === 'failed' ? 'bg-red-500/20 text-red-400' :
                      ''
                    }`}
                    style={status === 'pending' ? { background: 'var(--bg-card)', color: 'var(--text-secondary)' } : undefined}
                  >
                    {status === 'done' ? '✓' : status === 'running' ? '▶' : status === 'failed' ? '✗' : i + 1}
                  </span>
                  <span className="text-[10px] font-medium leading-tight" style={{ color: 'var(--text-primary)' }}>
                    {st.description.length > 80 ? st.description.slice(0, 80) + '...' : st.description}
                  </span>
                </div>
                {/* Files */}
                {st.files.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5 ml-7">
                    {st.files.map(f => (
                      <span
                        key={f}
                        className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}
                      >
                        {f.split('/').pop()}
                      </span>
                    ))}
                  </div>
                )}
                {/* Dependencies */}
                {st.dependsOn && st.dependsOn.length > 0 && (
                  <div className="text-[9px] mt-1 ml-7" style={{ color: 'var(--text-secondary)' }}>
                    depends on: {st.dependsOn.join(', ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Estimated files */}
      {plan.estimatedFiles.length > 0 && (
        <div className="p-2.5 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
          <p className="text-[9px] font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Files</p>
          <div className="flex flex-wrap gap-1">
            {plan.estimatedFiles.map(f => (
              <span
                key={f}
                className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 font-mono"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
