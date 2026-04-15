'use client';

import { highlightLine } from './CodeBlock';

interface DiffViewerProps {
  fileDiff: any;
  mode: 'unified' | 'split';
  fallbackContent?: string;
  onLoadFallback?: () => void;
}

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', css: 'css', html: 'html', json: 'json',
    yaml: 'yaml', yml: 'yaml', sh: 'bash', md: 'markdown',
  };
  return map[ext] ?? 'plaintext';
}

export function DiffViewer({ fileDiff, mode, fallbackContent, onLoadFallback }: DiffViewerProps) {
  const isNewFile = fileDiff?.status === 'added';
  const lang = fileDiff?.path ? detectLanguage(fileDiff.path) : 'plaintext';

  if (!fileDiff || fileDiff.hunks.length === 0) {
    if (onLoadFallback && !fallbackContent) onLoadFallback();
    if (!fallbackContent) return null;

    return (
      <div className="rounded-lg border border-gray-700 overflow-hidden">
        <div className="px-3 py-1.5 bg-emerald-900/20 border-b border-gray-700 text-xs text-emerald-400 flex items-center gap-2">
          {isNewFile && <span className="px-1.5 py-0.5 bg-emerald-500/20 rounded text-emerald-400">New file</span>}
          <span>{isNewFile ? 'All lines added' : 'No diff — current content'}</span>
        </div>
        {isNewFile ? (
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto bg-gray-950">
            {fallbackContent.split('\n').map((line, i) => (
              <div key={i} className="flex hover:bg-gray-800/50 font-mono text-xs leading-5">
                <span className="w-10 text-right pr-2 text-emerald-700 select-none shrink-0">{i + 1}</span>
                <span className="text-emerald-600 w-4 select-none shrink-0">+</span>
                <span className="text-emerald-300/80 whitespace-pre" dangerouslySetInnerHTML={{ __html: highlightLine(line, lang) }} />
              </div>
            ))}
          </div>
        ) : (
          <pre className="p-3 text-xs text-gray-300 overflow-x-auto max-h-96 bg-gray-950"><code>{fallbackContent}</code></pre>
        )}
      </div>
    );
  }
  if (mode === 'split') return <SplitDiff fileDiff={fileDiff} lang={lang} />;
  return <UnifiedDiff fileDiff={fileDiff} lang={lang} />;
}

function UnifiedDiff({ fileDiff, lang }: { fileDiff: any; lang: string }) {
  return (
    <div className="rounded-lg border border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
        <span className="text-xs text-gray-400 font-mono">{fileDiff.path}</span>
        <span className="text-xs"><span className="text-green-400">+{fileDiff.additions}</span> <span className="text-red-400">-{fileDiff.deletions}</span></span>
      </div>
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto bg-gray-950">
        {fileDiff.hunks.map((hunk: any, hi: number) => (
          <div key={hi}>
            <div className="px-3 py-1 text-xs text-blue-400 bg-blue-900/20 font-mono">{hunk.header}</div>
            {hunk.lines.map((line: any, li: number) => (
              <div key={li} className={`px-3 font-mono text-xs leading-5 whitespace-pre ${
                line.type === 'add' ? 'bg-green-900/20' :
                line.type === 'remove' ? 'bg-red-900/20' : ''
              }`}>
                <span className="inline-block w-8 text-right text-gray-600 mr-2 select-none">
                  {line.type === 'remove' ? line.oldLine : line.type === 'add' ? line.newLine : line.oldLine}
                </span>
                <span className={`inline-block w-3 text-center select-none ${
                  line.type === 'add' ? 'text-green-400' : line.type === 'remove' ? 'text-red-400' : 'text-gray-600'
                }`}>
                  {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                </span>
                <span
                  className={line.type === 'add' ? 'text-green-300/80' : line.type === 'remove' ? 'text-red-300/80' : 'text-gray-400'}
                  dangerouslySetInnerHTML={{ __html: highlightLine(line.content, lang) }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SplitDiff({ fileDiff, lang }: { fileDiff: any; lang: string }) {
  return (
    <div className="rounded-lg border border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
        <span className="text-xs text-gray-400 font-mono">{fileDiff.path}</span>
        <span className="text-xs"><span className="text-green-400">+{fileDiff.additions}</span> <span className="text-red-400">-{fileDiff.deletions}</span></span>
      </div>
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto bg-gray-950">
        {fileDiff.hunks.map((hunk: any, hi: number) => (
          <div key={hi}>
            <div className="px-3 py-1 text-xs text-blue-400 bg-blue-900/20 font-mono col-span-2">{hunk.header}</div>
            <div className="grid grid-cols-2 divide-x divide-gray-800">
              <div>
                {hunk.lines.filter((l: any) => l.type !== 'add').map((line: any, li: number) => (
                  <div key={li} className={`px-2 font-mono text-xs leading-5 whitespace-pre ${line.type === 'remove' ? 'bg-red-900/20' : ''}`}>
                    <span className="inline-block w-6 text-right text-gray-600 mr-1 select-none">{line.oldLine}</span>
                    <span
                      className={line.type === 'remove' ? 'text-red-300/80' : 'text-gray-400'}
                      dangerouslySetInnerHTML={{ __html: highlightLine(line.content, lang) }}
                    />
                  </div>
                ))}
              </div>
              <div>
                {hunk.lines.filter((l: any) => l.type !== 'remove').map((line: any, li: number) => (
                  <div key={li} className={`px-2 font-mono text-xs leading-5 whitespace-pre ${line.type === 'add' ? 'bg-green-900/20' : ''}`}>
                    <span className="inline-block w-6 text-right text-gray-600 mr-1 select-none">{line.newLine}</span>
                    <span
                      className={line.type === 'add' ? 'text-green-300/80' : 'text-gray-400'}
                      dangerouslySetInnerHTML={{ __html: highlightLine(line.content, lang) }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
