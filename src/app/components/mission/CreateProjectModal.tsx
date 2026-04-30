'use client';

import { useState, useEffect } from 'react';

interface CreateProjectModalProps {
  onClose: () => void;
  onCreated: (project: { id: string; name: string; path: string }) => void;
}

export default function CreateProjectModal({ onClose, onCreated }: CreateProjectModalProps) {
  const [name, setName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCreate = async () => {
    if (!name.trim() || !projectPath.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          path: projectPath.trim(),
          description: description.trim() || undefined,
          icon: icon.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create project');
        return;
      }
      onCreated(data);
      onClose();
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBrowse = async () => {
    try {
      const res = await fetch('/api/workspace/browse', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.path) setProjectPath(data.path);
      }
    } catch { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create new project"
        className="relative w-full max-w-lg rounded-xl border shadow-2xl p-6"
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">New Project</h2>
          <button
            onClick={onClose}
            className="text-lg leading-none hover:opacity-80"
            style={{ color: 'var(--text-secondary)' }}
          >
            &times;
          </button>
        </div>

        {/* Name */}
        <div className="mb-4">
          <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Project"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:border-indigo-500"
            style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
          />
        </div>

        {/* Path */}
        <div className="mb-4">
          <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Repository path <span className="text-red-400">*</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="/Users/me/repos/my-project"
              className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:border-indigo-500"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
            />
            <button
              type="button"
              onClick={handleBrowse}
              className="px-3 py-2 rounded-lg transition-colors text-sm whitespace-nowrap hover:opacity-80"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}
            >
              Browse
            </button>
          </div>
        </div>

        {/* Description */}
        <div className="mb-4">
          <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Description{' '}
            <span className="text-xs opacity-60">(optional)</span>
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this project do?"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:border-indigo-500"
            style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
          />
        </div>

        {/* Icon */}
        <div className="mb-5">
          <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Icon{' '}
            <span className="text-xs opacity-60">(optional, emoji)</span>
          </label>
          <input
            type="text"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="🚀"
            maxLength={10}
            className="w-24 px-3 py-2 border rounded-lg focus:outline-none focus:border-indigo-500 text-center text-lg"
            style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg border border-red-800 bg-red-900/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg hover:opacity-80 transition-colors"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!name.trim() || !projectPath.trim() || submitting}
            className="px-6 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
          >
            {submitting ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  );
}
