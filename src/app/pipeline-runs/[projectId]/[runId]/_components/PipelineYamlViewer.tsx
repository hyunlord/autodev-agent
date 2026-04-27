'use client';
import { useState } from 'react';
import { CodeBlock } from '@/app/tasks/[id]/components/CodeBlock';
import { PipelineYamlEditor } from './PipelineYamlEditor';
import { AIBuilderModal } from '@/app/components/AIBuilderModal';

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
  const [isAIBuilderOpen, setIsAIBuilderOpen] = useState(false);
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
            <span className="ml-auto flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  setIsAIBuilderOpen(true);
                }}
                className="text-xs px-2 py-1 border rounded"
                style={{ color: '#818cf8', borderColor: '#818cf8' }}
              >
                AI Generate
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  setEditing(true);
                }}
                className="text-xs px-2 py-1 border rounded"
                style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }}
              >
                Edit
              </button>
            </span>
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
      <AIBuilderModal
        isOpen={isAIBuilderOpen}
        onClose={() => setIsAIBuilderOpen(false)}
        projectId={projectId}
        currentYaml={yaml}
      />
    </section>
  );
}
