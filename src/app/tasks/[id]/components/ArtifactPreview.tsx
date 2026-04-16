'use client';

import { useState, useMemo } from 'react';
import { CodeBlock } from './CodeBlock';

interface ArtifactPreviewProps {
  files: Record<string, string>;
}

const EXT_LANG: Record<string, string> = {
  html: 'html', htm: 'html', css: 'css', js: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', json: 'json', py: 'python',
  sh: 'bash', yaml: 'yaml', yml: 'yaml', md: 'markdown',
};

function getLang(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[ext] ?? 'plaintext';
}

export function ArtifactPreview({ files }: ArtifactPreviewProps) {
  const fileNames = Object.keys(files);
  const [viewMode, setViewMode] = useState<'code' | 'preview' | 'split'>('split');
  const [selectedFile, setSelectedFile] = useState(fileNames[0] ?? '');

  const htmlFile = fileNames.find(f => f.endsWith('.html') || f.endsWith('.htm'));

  // Compose HTML + inline CSS/JS for iframe srcdoc
  const previewHtml = useMemo(() => {
    if (!htmlFile || !files[htmlFile]) return null;

    let html = files[htmlFile];

    // Inline CSS files
    for (const [name, content] of Object.entries(files)) {
      if (name.endsWith('.css')) {
        html = html.replace(
          new RegExp(`<link[^>]*href=["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*/?>`, 'gi'),
          `<style>${content}</style>`,
        );
      }
    }

    // Inline JS files
    for (const [name, content] of Object.entries(files)) {
      if (name.endsWith('.js') && !name.endsWith('.test.js') && !name.endsWith('.spec.js')) {
        html = html.replace(
          new RegExp(`<script[^>]*src=["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*></script>`, 'gi'),
          `<script>${content}</script>`,
        );
      }
    }

    return html;
  }, [files, htmlFile]);

  const canPreview = !!previewHtml;

  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border-color)' }}>
      {/* Header: view mode tabs */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
        <div className="flex gap-1">
          {(['code', 'preview', 'split'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              disabled={mode !== 'code' && !canPreview}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors capitalize ${
                viewMode === mode
                  ? 'bg-indigo-500/20 text-indigo-400'
                  : 'hover:opacity-80'
              } ${mode !== 'code' && !canPreview ? 'opacity-30 cursor-not-allowed' : ''}`}
              style={viewMode !== mode ? { color: 'var(--text-secondary)' } : undefined}
            >
              {mode}
            </button>
          ))}
        </div>
        {canPreview && (
          <button
            onClick={() => {
              const w = window.open('', '_blank');
              if (w) { w.document.write(previewHtml!); w.document.close(); }
            }}
            className="text-xs hover:opacity-80 transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            Open in new tab ↗
          </button>
        )}
      </div>

      {/* Content */}
      <div className={viewMode === 'split' ? 'grid grid-cols-2' : ''} style={{ minHeight: 400 }}>
        {/* Code panel */}
        {(viewMode === 'code' || viewMode === 'split') && (
          <div className={viewMode === 'split' ? 'border-r' : ''} style={viewMode === 'split' ? { borderColor: 'var(--border-color)' } : undefined}>
            {/* File tabs */}
            <div className="flex border-b overflow-x-auto" style={{ borderColor: 'var(--border-color)' }}>
              {fileNames.map(name => (
                <button
                  key={name}
                  onClick={() => setSelectedFile(name)}
                  className={`px-3 py-1.5 text-xs font-mono whitespace-nowrap transition-colors ${
                    selectedFile === name
                      ? 'bg-indigo-500/10 text-indigo-400 border-b-2 border-indigo-500'
                      : 'hover:opacity-80'
                  }`}
                  style={selectedFile !== name ? { color: 'var(--text-secondary)' } : undefined}
                >
                  {name}
                </button>
              ))}
            </div>
            <CodeBlock
              code={files[selectedFile] ?? ''}
              language={getLang(selectedFile)}
              maxHeight={500}
            />
          </div>
        )}

        {/* Preview panel */}
        {(viewMode === 'preview' || viewMode === 'split') && canPreview && (
          <div>
            <iframe
              srcDoc={previewHtml!}
              className="w-full border-0"
              style={{ height: 500 }}
              sandbox="allow-scripts"
              title="Artifact Preview"
            />
          </div>
        )}

        {/* No preview available */}
        {(viewMode === 'preview' || viewMode === 'split') && !canPreview && (
          <div className="flex items-center justify-center" style={{ height: 500, background: 'var(--bg-primary)' }}>
            <div className="text-center">
              <p className="text-2xl mb-2">📄</p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                No HTML file found — preview requires an .html file
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                For server apps, run the server and open in browser
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
