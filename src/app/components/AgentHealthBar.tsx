'use client';
import { useState, useEffect } from 'react';

interface HealthData {
  agentId: string;
  status: string;
  reason?: string;
  successRate: number;
  avgResponseTimeMs: number;
}

export default function AgentHealthBar() {
  const [healths, setHealths] = useState<HealthData[]>([]);

  useEffect(() => {
    const fetchHealth = () => {
      fetch('/api/agents/health')
        .then(r => r.json())
        .then(d => setHealths(d.healths ?? []))
        .catch(() => {});
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 60_000);
    return () => clearInterval(interval);
  }, []);

  const statusColor = (status: string) => {
    switch (status) {
      case 'available': return 'bg-emerald-500';
      case 'rate_limited': return 'bg-amber-500';
      case 'credit_exhausted': return 'bg-red-500';
      case 'unavailable': return 'bg-gray-500';
      default: return 'bg-gray-500';
    }
  };

  if (healths.length === 0) return null;

  return (
    <div className="flex items-center gap-3 text-xs">
      {healths.map(h => (
        <div
          key={h.agentId}
          className="flex items-center gap-1.5"
          title={`${h.agentId}: ${h.status}${h.reason ? ` (${h.reason})` : ''} — ${(h.successRate * 100).toFixed(0)}% success`}
        >
          <span className={`w-2 h-2 rounded-full ${statusColor(h.status)} ${h.status === 'available' ? 'animate-pulse' : ''}`} />
          <span style={{ color: 'var(--text-secondary)' }}>
            {h.agentId.replace('-cli', '').replace('-code', '')}
          </span>
        </div>
      ))}
    </div>
  );
}
