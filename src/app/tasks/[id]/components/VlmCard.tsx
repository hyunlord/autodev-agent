'use client';

interface VlmDetail {
  label: string;
  score: number;
  max: number;
}

interface Props {
  score: number;
  maxScore?: number;
  details?: VlmDetail[];
  issues?: string[];
  vlmModel?: string;
}

export function VlmCard({ score, maxScore = 15, details, issues, vlmModel }: Props) {
  const pct = Math.round((score / maxScore) * 100);
  const circumference = 2 * Math.PI * 28;
  const dashArray = `${(pct / 100) * circumference} ${circumference}`;

  return (
    <div className="bg-gray-900 rounded-lg p-3.5 border border-violet-500/30">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-xs font-medium text-violet-400">VLM design analysis</span>
        {vlmModel && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400">
            {vlmModel}
          </span>
        )}
      </div>
      <div className="flex gap-4 items-center">
        <svg viewBox="0 0 64 64" className="w-16 h-16 flex-shrink-0">
          <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(139,92,246,0.15)" strokeWidth="4" />
          <circle cx="32" cy="32" r="28" fill="none" stroke="#8b5cf6" strokeWidth="4"
            strokeDasharray={dashArray} strokeLinecap="round"
            transform="rotate(-90 32 32)" className="transition-all duration-700" />
          <text x="32" y="34" textAnchor="middle" className="text-xs font-medium fill-violet-400">
            {score}/{maxScore}
          </text>
        </svg>
        {details && details.length > 0 && (
          <div className="flex-1 grid grid-cols-2 gap-1.5">
            {details.map(d => (
              <div key={d.label} className="flex justify-between text-xs">
                <span className="text-gray-600">{d.label}</span>
                <span className="text-gray-300">{d.score}/{d.max}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {issues && issues.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mt-2.5">
          {issues.map(issue => (
            <span key={issue} className="text-xs px-2 py-0.5 bg-amber-500/12 text-amber-400 rounded">
              {issue}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
