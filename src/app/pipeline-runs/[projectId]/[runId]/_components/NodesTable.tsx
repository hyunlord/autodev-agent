import { StatusBadge } from '../../_components/StatusBadge';
import { formatDuration, formatRelativeTime } from '@/lib/utils/format';
import { extractNodeRows } from '../_lib/nodes-helpers';

export function NodesTable({ state }: { state: unknown }) {
  const rows = extractNodeRows(state);

  return (
    <section
      className="rounded border p-4"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
        Nodes ({rows.length})
      </h2>

      {rows.length === 0 ? (
        <p className="text-sm py-4" style={{ color: 'var(--text-secondary)' }}>
          No nodes recorded.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-left text-xs"
                style={{
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid var(--border-color)',
                }}
              >
                <th className="py-2 px-3 font-medium">Node ID</th>
                <th className="py-2 px-3 font-medium">Status</th>
                <th className="py-2 px-3 font-medium">Started</th>
                <th className="py-2 px-3 font-medium">Duration</th>
                <th className="py-2 px-3 font-medium">Attempt</th>
                <th className="py-2 px-3 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.nodeId}
                  style={{ borderBottom: '1px solid var(--border-color)' }}
                >
                  <td className="py-2 px-3 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                    {r.nodeId}
                  </td>
                  <td className="py-2 px-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="py-2 px-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {formatRelativeTime(r.startedAt)}
                  </td>
                  <td className="py-2 px-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {formatDuration(r.durationMs)}
                  </td>
                  <td className="py-2 px-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {r.attemptNumber ?? '-'}
                  </td>
                  <td
                    className="py-2 px-3 text-xs max-w-xs truncate text-red-400"
                    title={r.errorMessage ?? ''}
                  >
                    {r.errorMessage ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
