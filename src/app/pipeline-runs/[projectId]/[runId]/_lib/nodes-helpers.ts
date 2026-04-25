/**
 * Stage 7 G2 — Helpers for the detail-page Nodes section.
 *
 * Pure functions: take a parsed state JSON (whatever shape comes back from
 * `JSON.parse(stateJson)`) and return a stable, render-ready row array.
 * No React / Next.js imports so this module is unit-testable in vitest.
 */

export interface NodeRow {
  nodeId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attemptNumber: number | null;
  errorMessage: string | null;
}

/** Extract a flat list of node rows from the parsed pipeline_run_state JSON. */
export function extractNodeRows(state: unknown): NodeRow[] {
  if (state == null || typeof state !== 'object') return [];
  const nodes = (state as Record<string, unknown>).nodes;
  if (!nodes || typeof nodes !== 'object') return [];
  const entries = Object.entries(nodes as Record<string, unknown>);
  return entries.map(([id, raw]) => buildNodeRow(id, raw)).sort((a, b) => {
    // Stable order: by startedAt asc (nulls last), then nodeId asc.
    const aT = a.startedAt ? Date.parse(a.startedAt) : Number.POSITIVE_INFINITY;
    const bT = b.startedAt ? Date.parse(b.startedAt) : Number.POSITIVE_INFINITY;
    if (aT !== bT) return aT - bT;
    return a.nodeId.localeCompare(b.nodeId);
  });
}

function buildNodeRow(nodeId: string, raw: unknown): NodeRow {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const startedAt = stringOrNull(obj.startedAt);
  const completedAt = stringOrNull(obj.completedAt);
  return {
    nodeId,
    status: typeof obj.status === 'string' ? obj.status : 'unknown',
    startedAt,
    completedAt,
    durationMs: computeDurationMs(startedAt, completedAt),
    attemptNumber: typeof obj.attemptNumber === 'number' ? obj.attemptNumber : null,
    errorMessage: extractErrorMessage(obj.error),
  };
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function computeDurationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const s = Date.parse(startedAt);
  const e = Date.parse(completedAt);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  return e - s;
}

function extractErrorMessage(err: unknown): string | null {
  if (err == null) return null;
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const m = (err as Record<string, unknown>).message;
    if (typeof m === 'string') return m;
  }
  return null;
}
