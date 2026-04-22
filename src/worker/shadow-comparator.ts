import { db } from '@/lib/db/client';
import { shadowRuns } from '@/lib/db/schema';
import { nanoid } from 'nanoid';

export interface LegacyResult {
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface ShadowResult {
  ok: boolean;
  durationMs: number;
  finalStatus?: string;
  error?: string;
}

export async function recordComparison(
  taskId: string,
  projectId: string,
  legacy: LegacyResult,
  shadow: ShadowResult,
): Promise<void> {
  try {
    await db.insert(shadowRuns).values({
      id: nanoid(),
      taskId,
      projectId,
      legacyOk: legacy.ok,
      legacyDurationMs: legacy.durationMs,
      legacyError: legacy.error ?? null,
      shadowOk: shadow.ok,
      shadowDurationMs: shadow.durationMs,
      shadowError: shadow.error ?? null,
      shadowStatus: shadow.finalStatus ?? null,
      createdAt: new Date().toISOString(),
    }).run();
  } catch { /* comparator write failure is non-critical */ }
}
