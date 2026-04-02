import { db } from '@/lib/db/client';
import { attempts } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export async function GET() {
  const totals = db
    .select({
      totalCost: sql<number>`coalesce(sum(${attempts.costUsd}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${attempts.tokenCount}), 0)`,
      totalAttempts: sql<number>`count(*)`,
    })
    .from(attempts)
    .get();

  const byAgent = db
    .select({
      agentId: attempts.agentId,
      totalCost: sql<number>`coalesce(sum(${attempts.costUsd}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${attempts.tokenCount}), 0)`,
      attemptCount: sql<number>`count(*)`,
    })
    .from(attempts)
    .groupBy(attempts.agentId)
    .all();

  const byPhase = db
    .select({
      phase: attempts.phase,
      totalCost: sql<number>`coalesce(sum(${attempts.costUsd}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${attempts.tokenCount}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(attempts)
    .groupBy(attempts.phase)
    .all();

  const byDay = db
    .select({
      date: sql<string>`date(${attempts.createdAt})`,
      totalCost: sql<number>`coalesce(sum(${attempts.costUsd}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${attempts.tokenCount}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(attempts)
    .groupBy(sql`date(${attempts.createdAt})`)
    .orderBy(sql`date(${attempts.createdAt}) desc`)
    .limit(30)
    .all();

  const byStatus = db
    .select({
      status: attempts.status,
      count: sql<number>`count(*)`,
    })
    .from(attempts)
    .groupBy(attempts.status)
    .all();

  // Harness command costs from log
  const harnessStats = { totalCost: 0, totalCommands: 0 };
  const logPath = join(homedir(), '.autodev', 'harness-log.jsonl');
  if (existsSync(logPath)) {
    try {
      const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.action === 'command') {
            harnessStats.totalCommands++;
            harnessStats.totalCost += entry.costUsd ?? 0;
          }
        } catch { continue; }
      }
    } catch { /* no log */ }
  }

  return NextResponse.json({
    totals: {
      costUsd: (totals?.totalCost ?? 0) + harnessStats.totalCost,
      tokens: totals?.totalTokens ?? 0,
      attempts: totals?.totalAttempts ?? 0,
    },
    byAgent,
    byPhase,
    byDay,
    byStatus,
    harness: harnessStats,
  });
}
