import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { webhooks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const VALID_EVENTS = new Set(['completed', 'failed', 'low_score']);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (typeof body.name === 'string') updates.name = body.name.slice(0, 100);
    if (typeof body.enabled === 'boolean') updates.enabled = body.enabled;
    if (Array.isArray(body.events)) {
      if (body.events.length === 0) {
        return NextResponse.json({ error: 'events must be non-empty' }, { status: 400 });
      }
      for (const e of body.events) {
        if (!VALID_EVENTS.has(e)) {
          return NextResponse.json({ error: `invalid event: ${e}` }, { status: 400 });
        }
      }
      updates.events = body.events;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'no valid fields' }, { status: 400 });
    }

    db.update(webhooks).set(updates).where(eq(webhooks.id, id)).run();
    const row = db.select().from(webhooks).where(eq(webhooks.id, id)).get();
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    db.delete(webhooks).where(eq(webhooks.id, id)).run();
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
