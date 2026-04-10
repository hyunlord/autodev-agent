'use client';

import { useState } from 'react';
import { DiffViewer } from './DiffViewer';
import type { TaskDetail } from './types';

interface Props {
  task: TaskDetail;
  parsedResult: any;
  diffData: any;
  diffLoading: boolean;
  diffView: 'unified' | 'split';
  selectedDiffFile: string | null;
  previewFile: { path: string; content: string; language: string } | null;
  onSetDiffView: (v: 'unified' | 'split') => void;
  onLoadDiff: () => void;
  onToggleDiffFile: (f: string) => void;
  onLoadFilePreview: (f: string) => void;
}

export function DiffView({
  task, parsedResult, diffData, diffLoading, diffView, selectedDiffFile, previewFile,
  onSetDiffView, onLoadDiff, onToggleDiffFile, onLoadFilePreview,
}: Props) {
  const modifiedFiles: string[] = parsedResult?.modifiedFiles ?? [];

  if (modifiedFiles.length === 0 && !diffData) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
        No diff data available yet. Complete a task to see changes.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 파일 리스트 + view 전환 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {modifiedFiles.length} file{modifiedFiles.length !== 1 ? 's' : ''} changed
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => { onSetDiffView('unified'); onLoadDiff(); }}
            className={`text-[10px] px-2 py-0.5 rounded transition-colors ${diffView === 'unified' ? 'bg-indigo-900/50 text-indigo-300' : 'text-gray-500 hover:text-gray-300'}`}
          >
            Unified
          </button>
          <button
            onClick={() => { onSetDiffView('split'); onLoadDiff(); }}
            className={`text-[10px] px-2 py-0.5 rounded transition-colors ${diffView === 'split' ? 'bg-indigo-900/50 text-indigo-300' : 'text-gray-500 hover:text-gray-300'}`}
          >
            Split
          </button>
        </div>
      </div>

      {/* 파일 트리 */}
      <div className="space-y-1">
        {modifiedFiles.map((f: string, i: number) => {
          const fileDiff = diffData?.files?.find((d: any) => d.path === f);
          return (
            <button
              key={i}
              onClick={() => onToggleDiffFile(f)}
              className={`flex items-center justify-between w-full text-left text-xs px-2.5 py-1.5 rounded transition-colors ${
                selectedDiffFile === f
                  ? 'bg-indigo-900/30 text-indigo-300 border border-indigo-800'
                  : 'bg-gray-800/50 text-gray-300 hover:bg-gray-800'
              }`}
            >
              <span className="truncate">
                {fileDiff?.status === 'added' ? '+ ' : fileDiff?.status === 'deleted' ? '- ' : ''}{f}
              </span>
              {fileDiff && (
                <span className="flex gap-1 shrink-0 ml-2">
                  {fileDiff.additions > 0 && <span className="text-green-400">+{fileDiff.additions}</span>}
                  {fileDiff.deletions > 0 && <span className="text-red-400">-{fileDiff.deletions}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Diff 컨텐츠 */}
      {diffLoading && <div className="text-xs text-gray-500 p-3">Loading diff...</div>}
      {selectedDiffFile && diffData && (
        <DiffViewer
          fileDiff={diffData.files?.find((d: any) => d.path === selectedDiffFile)}
          mode={diffView}
          fallbackContent={previewFile?.content}
          onLoadFallback={() => onLoadFilePreview(selectedDiffFile)}
        />
      )}
      {selectedDiffFile && !diffData && !diffLoading && (
        <div className="text-xs text-gray-500 p-3 bg-gray-900 rounded">
          Diff not available.
          {previewFile && (
            <pre className="mt-2 text-gray-300 overflow-x-auto max-h-96"><code>{previewFile.content}</code></pre>
          )}
        </div>
      )}
    </div>
  );
}
