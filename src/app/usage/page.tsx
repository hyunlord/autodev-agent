'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

const PHASE_COLORS: Record<string, string> = {
  planning: '#f59e0b',   // amber
  coding: '#6366f1',     // indigo
  verifying: '#10b981',  // emerald
};

const AGENT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4'];

interface UsageData {
  totals: { costUsd: number; tokens: number; attempts: number };
  byAgent: Array<{ agentId: string; totalCost: number; totalTokens: number; attemptCount: number }>;
  byPhase: Array<{ phase: string; totalCost: number; totalTokens: number; count: number }>;
  byDay: Array<{ date: string; totalCost: number; totalTokens: number; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  harness?: { totalCost: number; totalCommands: number };
}

interface RecentAttempt {
  id: string;
  agentId: string;
  phase: string;
  status: string;
  costUsd: number | null;
  tokenCount: number | null;
  durationMs: number | null;
  createdAt: string;
}

export default function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [recentAttempts, setRecentAttempts] = useState<RecentAttempt[]>([]);

  useEffect(() => {
    fetch('/api/usage').then(r => r.json()).then(setData).catch(() => {});
    fetch('/api/usage/recent').then(r => r.json()).then(setRecentAttempts).catch(() => {});
  }, []);

  if (!data) {
    return (
      <div className="min-h-screen p-8 max-w-6xl mx-auto text-gray-400">
        <div className="flex items-center justify-between mb-6">
          <Link href="/" className="text-indigo-400 hover:text-indigo-300 text-sm">← Back</Link>
          <h1 className="text-xl font-bold">Cost Dashboard</h1>
        </div>
        Loading...
      </div>
    );
  }

  const successRate = (() => {
    const total = data.byStatus.reduce((s, b) => s + b.count, 0);
    const success = data.byStatus.find((b) => b.status === 'success')?.count ?? 0;
    return total > 0 ? Math.round((success / total) * 100) : 0;
  })();

  // byDay는 API에서 desc로 옴 — 차트 표시 위해 시간순(asc) 정렬
  const dailyData = [...data.byDay].reverse();
  const hasDaily = dailyData.length > 1;
  const hasAgents = data.byAgent.length > 0;
  const hasPhases = data.byPhase.length > 0;
  const hasAttempts = recentAttempts.length > 0;
  const isEmpty = data.totals.attempts === 0;

  const sortedAgents = [...data.byAgent].sort((a, b) => b.totalCost - a.totalCost);
  const maxAgentCost = sortedAgents[0]?.totalCost ?? 0;
  const phaseTotal = data.byPhase.reduce((s, p) => s + p.totalCost, 0);

  return (
    <div className="min-h-screen p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <Link href="/" className="text-indigo-400 hover:text-indigo-300 text-sm">← Back to Dashboard</Link>
        <h1 className="text-xl font-bold">Cost Dashboard</h1>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Total Cost" value={`$${data.totals.costUsd.toFixed(4)}`} />
        <SummaryCard label="Total Tokens" value={data.totals.tokens.toLocaleString()} />
        <SummaryCard label="Attempts" value={data.totals.attempts.toString()} />
        <SummaryCard label="Success Rate" value={`${successRate}%`} />
      </div>

      {isEmpty && (
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-12 text-center text-gray-500">
          No usage data yet. Run a task from the dashboard to start tracking costs.
        </div>
      )}

      {/* Daily trend (SVG sparkline) */}
      {hasDaily && (
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4 mb-6">
          <h2 className="text-sm font-semibold mb-3 text-gray-300">Daily Cost Trend</h2>
          <DailyTrendChart data={dailyData} />
        </div>
      )}

      {/* Agent + Phase side by side */}
      {(hasAgents || hasPhases) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {hasAgents && (
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
              <h2 className="text-sm font-semibold mb-3 text-gray-300">By Agent</h2>
              <div className="space-y-2">
                {sortedAgents.map((agent, i) => {
                  const width = maxAgentCost > 0 ? (agent.totalCost / maxAgentCost) * 100 : 0;
                  return (
                    <div key={agent.agentId} className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-400 w-32 truncate" title={agent.agentId}>
                        {agent.agentId}
                      </span>
                      <div className="flex-1 bg-gray-800 rounded-full h-3 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.max(width, 2)}%`,
                            backgroundColor: AGENT_COLORS[i % AGENT_COLORS.length],
                          }}
                        />
                      </div>
                      <span className="text-[11px] text-gray-500 w-28 text-right tabular-nums">
                        ${agent.totalCost.toFixed(4)} ({agent.attemptCount})
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {hasPhases && (
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
              <h2 className="text-sm font-semibold mb-3 text-gray-300">By Phase</h2>
              <PhaseBreakdown data={data.byPhase} total={phaseTotal} />
            </div>
          )}
        </div>
      )}

      {/* Recent attempts table */}
      {hasAttempts && (
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
          <h2 className="text-sm font-semibold mb-3 text-gray-300">Recent Attempts</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left py-2 px-2">Date</th>
                  <th className="text-left py-2 px-2">Agent</th>
                  <th className="text-left py-2 px-2">Phase</th>
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="text-right py-2 px-2">Cost</th>
                  <th className="text-right py-2 px-2">Tokens</th>
                  <th className="text-right py-2 px-2">Duration</th>
                </tr>
              </thead>
              <tbody>
                {recentAttempts.map((a) => (
                  <tr key={a.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-1.5 px-2 text-gray-400 whitespace-nowrap">
                      {new Date(a.createdAt).toLocaleString()}
                    </td>
                    <td className="py-1.5 px-2 text-gray-300">{a.agentId}</td>
                    <td className="py-1.5 px-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        a.phase === 'planning' ? 'bg-amber-900/30 text-amber-400' :
                        a.phase === 'coding' ? 'bg-indigo-900/30 text-indigo-400' :
                        'bg-emerald-900/30 text-emerald-400'
                      }`}>{a.phase}</span>
                    </td>
                    <td className="py-1.5 px-2">
                      <span className={
                        a.status === 'success' ? 'text-green-400' :
                        a.status === 'error' ? 'text-red-400' :
                        'text-yellow-400'
                      }>
                        {a.status}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right text-gray-300 tabular-nums">
                      ${(a.costUsd ?? 0).toFixed(4)}
                    </td>
                    <td className="py-1.5 px-2 text-right text-gray-400 tabular-nums">
                      {(a.tokenCount ?? 0).toLocaleString()}
                    </td>
                    <td className="py-1.5 px-2 text-right text-gray-400 tabular-nums">
                      {a.durationMs ? `${(a.durationMs / 1000).toFixed(1)}s` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4 text-center">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-xl font-bold text-gray-200 mt-1 tabular-nums">{value}</p>
    </div>
  );
}

/**
 * 일별 비용 추세 — 순수 SVG sparkline (line + filled area)
 */
function DailyTrendChart({ data }: { data: Array<{ date: string; totalCost: number; count: number }> }) {
  const W = 800;
  const H = 180;
  const PAD_X = 40;
  const PAD_Y = 20;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;

  const maxCost = Math.max(...data.map(d => d.totalCost), 0);
  const minCost = 0;
  const xStep = data.length > 1 ? innerW / (data.length - 1) : innerW;

  const points = data.map((d, i) => {
    const x = PAD_X + i * xStep;
    const y = maxCost > 0
      ? PAD_Y + innerH - ((d.totalCost - minCost) / maxCost) * innerH
      : PAD_Y + innerH;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${PAD_Y + innerH} L ${points[0].x} ${PAD_Y + innerH} Z`;

  // Y-axis ticks (4단계)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    v: maxCost * t,
    y: PAD_Y + innerH - t * innerH,
  }));

  // X-axis labels — 데이터가 많으면 솎아내기
  const labelStride = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[200px]" preserveAspectRatio="xMidYMid meet">
        {/* Grid + Y labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_X} y1={t.y} x2={W - PAD_X} y2={t.y} stroke="#374151" strokeDasharray="3 3" />
            <text x={PAD_X - 6} y={t.y + 3} textAnchor="end" fontSize="10" fill="#9ca3af">
              ${t.v.toFixed(3)}
            </text>
          </g>
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="#6366f1" fillOpacity="0.2" />

        {/* Line */}
        <path d={linePath} fill="none" stroke="#6366f1" strokeWidth="2" />

        {/* Points + tooltips (browser title) */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3" fill="#6366f1">
              <title>{`${p.date}: $${p.totalCost.toFixed(4)} (${p.count} attempts)`}</title>
            </circle>
            {i % labelStride === 0 && (
              <text x={p.x} y={H - 4} textAnchor="middle" fontSize="9" fill="#9ca3af">
                {p.date.slice(5)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

/**
 * 단계별 비용 — stacked horizontal bar + legend
 */
function PhaseBreakdown({
  data,
  total,
}: {
  data: Array<{ phase: string; totalCost: number; count: number }>;
  total: number;
}) {
  if (total <= 0) {
    return <p className="text-xs text-gray-500">No phase data</p>;
  }
  return (
    <div>
      <div className="flex h-6 rounded-full overflow-hidden bg-gray-800 mb-3">
        {data.map((p) => {
          const pct = (p.totalCost / total) * 100;
          return (
            <div
              key={p.phase}
              className="h-full transition-all"
              style={{
                width: `${pct}%`,
                backgroundColor: PHASE_COLORS[p.phase] ?? '#6b7280',
              }}
              title={`${p.phase}: $${p.totalCost.toFixed(4)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="space-y-1.5">
        {data.map((p) => {
          const pct = total > 0 ? (p.totalCost / total) * 100 : 0;
          return (
            <div key={p.phase} className="flex items-center gap-2 text-xs">
              <span
                className="w-3 h-3 rounded-sm flex-shrink-0"
                style={{ backgroundColor: PHASE_COLORS[p.phase] ?? '#6b7280' }}
              />
              <span className="text-gray-300 capitalize w-20">{p.phase}</span>
              <span className="text-gray-500 flex-1 tabular-nums">${p.totalCost.toFixed(4)}</span>
              <span className="text-gray-500 tabular-nums w-12 text-right">{pct.toFixed(1)}%</span>
              <span className="text-gray-600 tabular-nums w-12 text-right">({p.count})</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
