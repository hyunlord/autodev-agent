import { db } from '@/lib/db/client';
import { attempts } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

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

  const byDay = db
    .select({
      date: sql<string>`date(${attempts.createdAt})`,
      totalCost: sql<number>`coalesce(sum(${attempts.costUsd}), 0)`,
    })
    .from(attempts)
    .groupBy(sql`date(${attempts.createdAt})`)
    .orderBy(sql`date(${attempts.createdAt}) desc`)
    .limit(7)
    .all();

  return NextResponse.json({
    totals: {
      costUsd: totals?.totalCost ?? 0,
      tokens: totals?.totalTokens ?? 0,
      attempts: totals?.totalAttempts ?? 0,
    },
    byAgent,
    byDay,
  });
}
