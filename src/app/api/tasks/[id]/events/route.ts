import { db } from '@/lib/db/client';
import { events } from '@/lib/db/schema';
import { eq, desc, count } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const rawLimit = parseInt(url.searchParams.get('limit') ?? '100', 10);
  const rawOffset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const limit = Math.min(Number.isNaN(rawLimit) ? 100 : rawLimit, 500);
  const offset = Number.isNaN(rawOffset) ? 0 : rawOffset;

  const [totalResult] = db.select({ total: count() }).from(events).where(eq(events.taskId, id)).all();
  const total = totalResult?.total ?? 0;

  const rows = db
    .select()
    .from(events)
    .where(eq(events.taskId, id))
    .limit(limit)
    .offset(offset)
    .all();

  return NextResponse.json({ events: rows, total, limit, offset });
}
