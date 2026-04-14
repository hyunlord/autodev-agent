import { db } from '@/lib/db/client';
import { tasks, attempts, verifications, events } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const includeEvents = url.searchParams.get('include')?.includes('events');

  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const taskAttempts = db.select().from(attempts).where(eq(attempts.taskId, id)).all();

  const attemptsWithVerifications = taskAttempts.map((attempt) => ({
    ...attempt,
    verifications: db.select().from(verifications).where(eq(verifications.attemptId, attempt.id)).all(),
  }));

  const result: any = {
    ...task,
    attempts: attemptsWithVerifications,
  };

  if (includeEvents) {
    result.events = db.select().from(events).where(eq(events.taskId, id)).all();
  }

  return NextResponse.json(result);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { action, plan: editedPlan } = body;

  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (action === 'stop') {
    db.update(tasks).set({
      status: 'failed',
      result: JSON.stringify({
        summary: 'Stopped by user',
        stoppedAt: new Date().toISOString(),
        stopReason: 'user_requested',
      }),
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, id)).run();
    return NextResponse.json({ success: true, action: 'stopped' });
  }

  if (action === 'approve') {
    if (editedPlan) {
      db.update(tasks).set({
        plan: JSON.stringify(editedPlan),
        updatedAt: new Date().toISOString(),
      }).where(eq(tasks.id, id)).run();
    }
    db.update(tasks).set({
      status: 'coding',
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, id)).run();
    return NextResponse.json({ success: true, action: 'approved' });
  }

  if (action === 'reject') {
    db.update(tasks).set({
      status: 'failed',
      result: JSON.stringify({ error: 'Plan rejected by user' }),
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, id)).run();
    return NextResponse.json({ success: true, action: 'rejected' });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  db.delete(tasks).where(eq(tasks.id, id)).run();
  return NextResponse.json({ deleted: true });
}
