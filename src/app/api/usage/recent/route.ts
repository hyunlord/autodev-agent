import { db } from '@/lib/db/client';
import { attempts } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET() {
  const recent = db
    .select({
      id: attempts.id,
      agentId: attempts.agentId,
      phase: attempts.phase,
      status: attempts.status,
      costUsd: attempts.costUsd,
      tokenCount: attempts.tokenCount,
      durationMs: attempts.durationMs,
      createdAt: attempts.createdAt,
    })
    .from(attempts)
    .orderBy(desc(attempts.createdAt))
    .limit(50)
    .all();

  return NextResponse.json(recent);
}
