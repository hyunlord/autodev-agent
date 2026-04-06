import type { PipelineEvent } from '../lib/types';
import type { AttemptRecord } from './retry';

export type EmitFn = (event: PipelineEvent) => void;

// ─── Single cycle result type ────────────────────────────
export interface SingleCycleResult {
  success: boolean;
  summary: string;
  modifiedFiles: string[];
  costUsd: number;
  attemptCount: number;
  totalDurationMs: number;
  failedChecks: Array<{ id: string; description: string; actual?: string }>;
  attemptRecords: AttemptRecord[];
  stopReason?: string;
}

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Task cancelled');
  }
}
