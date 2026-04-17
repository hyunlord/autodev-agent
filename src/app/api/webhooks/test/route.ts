import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { webhooks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sendSingle } from '@/lib/webhooks/sender';

export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const hook = db.select().from(webhooks).where(eq(webhooks.id, id)).get();
    if (!hook) return NextResponse.json({ error: 'webhook not found' }, { status: 404 });

    const result = await sendSingle(hook, {
      event: 'completed',
      task: {
        id: 'test-task',
        title: 'AutoDev Webhook Test',
        status: 'completed',
        costUsd: 0,
        verifyScore: 100,
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
