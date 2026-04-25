'use client';
import { useState } from 'react';
import { CodeBlock } from '@/app/tasks/[id]/components/CodeBlock';
import { PipelineYamlEditor } from './PipelineYamlEditor';

/**
 * Stage 7 G5 — Adds Edit toggle to the G4 read-only viewer.
 * Converted to Client Component to hold editing state.
 * In read mode renders CodeBlock as before; in edit mode swaps to
 * PipelineYamlEditor (textarea + save/cancel).
 */
export function PipelineYamlViewer({
  yaml,
  projectId,
}: {
  yaml: string | null;
  projectId: string;
}) {
  const [editing, setEditing] = useState(false);
  if (!yaml) return null;
  const lineCount = yaml.split('\n').length;

  return (
    <section
      className="rounded border p-4"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <details>
        <summary
          className="cursor-pointer text-lg font-semibold flex items-center gap-2"
          style={{ color: 'var(--text-primary)' }}
        >
          <span>Pipeline YAML</span>
          {!editing && (
            <span className="text-xs font-normal" style={{ color: 'var(--text-secondary)' }}>
              ({lineCount} line{lineCount === 1 ? '' : 's'})
            </span>
          )}
          {!editing && (
            <button
              onClick={(e) => {
                e.preventDefault();
                setEditing(true);
              }}
              className="ml-auto text-xs px-2 py-1 border rounded"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }}
            >
              Edit
            </button>
          )}
        </summary>
        <div className="mt-3">
          {editing ? (
            <PipelineYamlEditor
              initialYaml={yaml}
              projectId={projectId}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                window.location.reload();
              }}
            />
          ) : (
            <CodeBlock code={yaml} language="yaml" maxHeight={600} />
          )}
        </div>
      </details>
    </section>
  );
}
