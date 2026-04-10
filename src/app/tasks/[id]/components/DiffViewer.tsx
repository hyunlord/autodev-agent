'use client';

interface DiffViewerProps {
  fileDiff: any;
  mode: 'unified' | 'split';
  fallbackContent?: string;
  onLoadFallback?: () => void;
}

export function DiffViewer({ fileDiff, mode, fallbackContent, onLoadFallback }: DiffViewerProps) {
  if (!fileDiff || fileDiff.hunks.length === 0) {
    if (onLoadFallback && !fallbackContent) onLoadFallback();
    return fallbackContent ? (
      <div className="rounded-lg border border-gray-700 overflow-hidden">
        <div className="px-3 py-1.5 bg-gray-800 border-b border-gray-700 text-xs text-gray-400">No diff — current content</div>
        <pre className="p-3 text-xs text-gray-300 overflow-x-auto max-h-96 bg-gray-950"><code>{fallbackContent}</code></pre>
      </div>
    ) : null;
  }
  if (mode === 'split') return <SplitDiff fileDiff={fileDiff} />;
  return <UnifiedDiff fileDiff={fileDiff} />;
}

function UnifiedDiff({ fileDiff }: { fileDiff: any }) {
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
                line.type === 'add' ? 'bg-green-900/20 text-green-300' :
                line.type === 'remove' ? 'bg-red-900/20 text-red-300' : 'text-gray-400'
              }`}>
                <span className="inline-block w-8 text-right text-gray-600 mr-2 select-none">
                  {line.type === 'remove' ? line.oldLine : line.type === 'add' ? line.newLine : line.oldLine}
                </span>
                <span className="inline-block w-3 text-center select-none">
                  {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                </span>
                {line.content}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SplitDiff({ fileDiff }: { fileDiff: any }) {
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
                  <div key={li} className={`px-2 font-mono text-xs leading-5 whitespace-pre ${line.type === 'remove' ? 'bg-red-900/20 text-red-300' : 'text-gray-400'}`}>
                    <span className="inline-block w-6 text-right text-gray-600 mr-1 select-none">{line.oldLine}</span>
                    {line.content}
                  </div>
                ))}
              </div>
              <div>
                {hunk.lines.filter((l: any) => l.type !== 'remove').map((line: any, li: number) => (
                  <div key={li} className={`px-2 font-mono text-xs leading-5 whitespace-pre ${line.type === 'add' ? 'bg-green-900/20 text-green-300' : 'text-gray-400'}`}>
                    <span className="inline-block w-6 text-right text-gray-600 mr-1 select-none">{line.newLine}</span>
                    {line.content}
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
