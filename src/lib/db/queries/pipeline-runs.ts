import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { pipelineRuns, pipelineRunState, pipelineEvents } from '@/lib/db/schema';

/**
 * Stage 7 G0 — Pipeline runs / state / events read layer.
 *
 * Pure query helpers (no mutations). Used by /api/pipeline-runs/* routes and
 * Stage 7 UI pages. Schema is the source of truth: any column missing here
 * (e.g. lastCheckpointAt) is intentionally elided from the public surface
 * until a UI consumer actually needs it.
 */

export type PipelineRunRow = typeof pipelineRuns.$inferSelect;

const EVENTS_LIMIT_DEFAULT = 100;
const EVENTS_LIMIT_MAX = 1000;
const RUNS_LIMIT_DEFAULT = 20;
const RUNS_LIMIT_MAX = 100;

export function getPipelineRun(runId: string): PipelineRunRow | null {
  const row = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get();
  return row ?? null;
}

export function listPipelineRunsByTask(taskId: string): PipelineRunRow[] {
  return db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.taskId, taskId))
    .orderBy(desc(pipelineRuns.startedAt))
    .all();
}

export function listPipelineRunsByProject(
  projectId: string,
  options: { limit?: number; offset?: number } = {},
): PipelineRunRow[] {
  const limit = clamp(options.limit ?? RUNS_LIMIT_DEFAULT, 1, RUNS_LIMIT_MAX);
  const offset = Math.max(0, options.offset ?? 0);
  return db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.projectId, projectId))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(limit)
    .offset(offset)
    .all();
}

export interface PipelineRunStateView {
  runId: string;
  state: unknown; // parsed JSON; downstream may further validate
  version: number;
  updatedAt: string;
}

export function getPipelineRunState(runId: string): PipelineRunStateView | null {
  const row = db
    .select()
    .from(pipelineRunState)
    .where(eq(pipelineRunState.runId, runId))
    .get();
  if (!row) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.stateJson);
  } catch {
    parsed = null; // Corrupt row — caller decides how to surface.
  }
  return {
    runId: row.runId,
    state: parsed,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export type PipelineEventRow = typeof pipelineEvents.$inferSelect;

export interface ListEventsOptions {
  /** Exact event type match (e.g. "node.completed"). */
  type?: string;
  /** ISO timestamp (exclusive lower bound on createdAt). */
  since?: string;
  limit?: number;
  offset?: number;
}

export function listPipelineEvents(
  runId: string,
  options: ListEventsOptions = {},
): PipelineEventRow[] {
  const limit = clamp(options.limit ?? EVENTS_LIMIT_DEFAULT, 1, EVENTS_LIMIT_MAX);
  const offset = Math.max(0, options.offset ?? 0);

  const filters = [eq(pipelineEvents.runId, runId)];
  if (options.type) filters.push(eq(pipelineEvents.type, options.type));
  if (options.since) filters.push(gt(pipelineEvents.createdAt, options.since));

  return db
    .select()
    .from(pipelineEvents)
    .where(and(...filters))
    .orderBy(asc(pipelineEvents.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

export const _internal = {
  EVENTS_LIMIT_DEFAULT,
  EVENTS_LIMIT_MAX,
  RUNS_LIMIT_DEFAULT,
  RUNS_LIMIT_MAX,
};
