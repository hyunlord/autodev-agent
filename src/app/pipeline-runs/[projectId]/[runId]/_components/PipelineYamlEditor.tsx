'use client';
import { useState } from 'react';

export function PipelineYamlEditor({
  initialYaml,
  projectId,
  onCancel,
  onSaved,
}: {
  initialYaml: string;
  projectId: string;
  onCancel: () => void;
  onSaved: (versionId: string) => void;
}) {
  const [content, setContent] = useState(initialYaml);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/pipeline-versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, yaml: content }),
      });
      if (!res.ok) {
        const data = await res.json() as { message?: string; error?: string };
        setError(data.message ?? data.error ?? 'Save failed');
        return;
      }
      const data = await res.json() as { data: { id: string } };
      onSaved(data.data.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        className="w-full h-96 p-3 font-mono text-xs border rounded"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
      />
      {error && (
        <div className="text-red-600 text-sm border-l-4 border-red-500 bg-red-50 p-2">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 border rounded text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
