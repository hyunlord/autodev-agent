import { CodeBlock } from '@/app/tasks/[id]/components/CodeBlock';

/**
 * Stage 7 G4 — Read-only viewer for the pipeline YAML that produced a run.
 *
 * Reuses the existing `CodeBlock` (Client Component) instead of redoing the
 * highlight.js wiring + github-dark.css import — same syntax-highlighting
 * pipeline, no new theme assets, no new dependency. The collapsible
 * `<details>` element matches StateJsonViewer's interaction pattern so the
 * detail page stays visually consistent.
 */
export function PipelineYamlViewer({ yaml }: { yaml: string | null }) {
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
          <span className="text-xs font-normal" style={{ color: 'var(--text-secondary)' }}>
            ({lineCount} line{lineCount === 1 ? '' : 's'})
          </span>
        </summary>
        <div className="mt-3">
          <CodeBlock code={yaml} language="yaml" maxHeight={600} />
        </div>
      </details>
    </section>
  );
}
