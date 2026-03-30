import { db } from '@/lib/db/client';
import { tasks, attempts, verifications, events } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const taskAttempts = db.select().from(attempts).where(eq(attempts.taskId, id)).all();
  const taskEvents = db.select().from(events).where(eq(events.taskId, id)).all();

  const attemptsWithVerifications = taskAttempts.map((attempt) => ({
    ...attempt,
    verifications: db.select().from(verifications).where(eq(verifications.attemptId, attempt.id)).all(),
  }));

  return NextResponse.json({
    ...task,
    attempts: attemptsWithVerifications,
    events: taskEvents,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { action, plan: editedPlan } = body;

  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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
