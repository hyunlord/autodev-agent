export function StateJsonViewer({ state }: { state: unknown }) {
  if (state == null) return null;
  return (
    <section
      className="rounded border p-4"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <details>
        <summary
          className="cursor-pointer text-lg font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          Raw State JSON
        </summary>
        <pre
          className="mt-3 p-3 rounded overflow-x-auto text-xs font-mono"
          style={{
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            maxHeight: '60vh',
          }}
        >
          {JSON.stringify(state, null, 2)}
        </pre>
      </details>
    </section>
  );
}
