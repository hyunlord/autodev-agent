'use client';
import { useState, useEffect } from 'react';

interface Suggestion {
  id: string;
  title: string;
  description: string;
  ruleText: string;
  priority: 'high' | 'medium' | 'low';
  selected: boolean;
}

interface EvolveStats {
  totalTasks: number;
  failedCount: number;
  avgScore: number | null;
  uniqueIssues: string[];
}

interface EvolveData {
  stats: EvolveStats;
  analysis: string;
  suggestions: Suggestion[];
  confidence: number;
  currentPrompt: string;
  role: string;
}

interface EvolveModalProps {
  role: string;
  projectDir?: string;
  onClose: () => void;
}

const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-red-900/30 text-red-400',
  medium: 'bg-amber-900/30 text-amber-400',
  low: 'bg-gray-700/40 text-gray-400',
};

export default function EvolveModal({ role, projectDir, onClose }: EvolveModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<EvolveData | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    const analyze = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/harness/evolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role, projectDir }),
        });
        const result = await res.json();
        if (!res.ok) {
          setError(result.error ?? '분석 실패');
          setLoading(false);
          return;
        }
        setData(result);
        setSuggestions(result.suggestions ?? []);
      } catch {
        setError('네트워크 오류 — 다시 시도해주세요');
      }
      setLoading(false);
    };
    analyze();
  }, [role, projectDir]);

  const toggleSuggestion = (id: string) => {
    setSuggestions(prev =>
      prev.map(s => s.id === id ? { ...s, selected: !s.selected } : s)
    );
  };

  const selectedCount = suggestions.filter(s => s.selected).length;

  const handleApply = async () => {
    setApplying(true);
    try {
      const res = await fetch('/api/harness/apply-evolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, suggestions, projectDir }),
      });
      const result = await res.json();
      if (result.success) {
        setApplied(true);
      } else {
        setError(result.error ?? '적용 실패');
      }
    } catch {
      setError('네트워크 오류');
    }
    setApplying(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border shadow-2xl"
        style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              Prompt Evolution — {role}.md
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              작업 이력을 분석하여 프롬프트 개선안을 제시합니다
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xl px-2 py-1 rounded-lg hover:opacity-70 transition-opacity"
            style={{ color: 'var(--text-secondary)' }}
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-8 h-8 border-2 border-t-indigo-500 rounded-full animate-spin" style={{ borderColor: 'var(--border-color)', borderTopColor: '#6366f1' }} />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Gemini CLI로 작업 이력을 분석 중...
              </p>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="px-4 py-3 rounded-xl border border-red-800 bg-red-900/20">
              <p className="text-sm text-red-400">{error}</p>
              <button
                onClick={onClose}
                className="mt-2 px-3 py-1 text-xs text-red-400 border border-red-800 rounded-lg hover:bg-red-900/30 transition-colors"
              >
                닫기
              </button>
            </div>
          )}

          {/* Applied success */}
          {applied && (
            <div className="px-4 py-3 rounded-xl border border-emerald-800 bg-emerald-900/20">
              <p className="text-sm text-emerald-400">프롬프트에 성공적으로 적용되었습니다.</p>
              <button
                onClick={onClose}
                className="mt-2 px-3 py-1 text-xs text-emerald-400 border border-emerald-800 rounded-lg hover:bg-emerald-900/30 transition-colors"
              >
                닫기
              </button>
            </div>
          )}

          {/* Data loaded */}
          {data && !loading && !applied && (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-xl border p-3 text-center" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                  <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{data.stats.totalTasks}</p>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>분석된 작업</p>
                </div>
                <div className="rounded-xl border p-3 text-center" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                  <p className="text-2xl font-bold text-red-400">{data.stats.failedCount}</p>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>실패 작업</p>
                </div>
                <div className="rounded-xl border p-3 text-center" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                  <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    {data.stats.avgScore !== null ? data.stats.avgScore : '—'}
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>평균 점수</p>
                </div>
                <div className="rounded-xl border p-3 text-center" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                  <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{data.stats.uniqueIssues.length}</p>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>고유 이슈</p>
                </div>
              </div>

              {/* Analysis Summary */}
              <div className="rounded-xl border p-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>분석 요약</h3>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{data.analysis}</p>
                {data.confidence > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>신뢰도:</span>
                    <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--border-color)' }}>
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${Math.round(data.confidence * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {Math.round(data.confidence * 100)}%
                    </span>
                  </div>
                )}
              </div>

              {/* Suggestions */}
              {suggestions.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    개선 제안 ({selectedCount}/{suggestions.length} 선택)
                  </h3>
                  {suggestions.map(s => (
                    <label
                      key={s.id}
                      className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:opacity-90"
                      style={{
                        background: s.selected ? 'var(--bg-card, var(--bg-secondary))' : 'var(--bg-secondary)',
                        borderColor: s.selected ? '#6366f1' : 'var(--border-color)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={s.selected}
                        onChange={() => toggleSuggestion(s.id)}
                        className="mt-0.5 accent-indigo-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{s.title}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${PRIORITY_STYLES[s.priority] ?? PRIORITY_STYLES.low}`}>
                            {s.priority}
                          </span>
                        </div>
                        <p className="text-[11px] mb-1.5" style={{ color: 'var(--text-secondary)' }}>{s.description}</p>
                        <pre className="text-[11px] whitespace-pre-wrap p-2 rounded-lg" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
                          {s.ruleText}
                        </pre>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm rounded-lg border transition-colors hover:opacity-80"
                  style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }}
                >
                  취소
                </button>
                <button
                  onClick={handleApply}
                  disabled={selectedCount === 0 || applying}
                  className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-40 transition-colors"
                >
                  {applying ? '적용 중...' : `선택한 ${selectedCount}개 적용`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
