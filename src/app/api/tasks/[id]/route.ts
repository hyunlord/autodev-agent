import { db } from '@/lib/db/client';
import { tasks, attempts, verifications, events } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const includeEvents = url.searchParams.get('include')?.includes('events');

  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const taskAttempts = db.select().from(attempts).where(eq(attempts.taskId, id)).all();

  const attemptIds = taskAttempts.map(a => a.id);
  const allVerifications = attemptIds.length > 0
    ? db.select().from(verifications).where(inArray(verifications.attemptId, attemptIds)).all()
    : [];

  const attemptsWithVerifications = taskAttempts.map((attempt) => ({
    ...attempt,
    verifications: allVerifications.filter(v => v.attemptId === attempt.id),
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

  const terminalStatuses = ['completed', 'failed', 'escalated'];

  if (action === 'stop') {
    if (terminalStatuses.includes(task.status)) {
      return NextResponse.json({ error: `Cannot stop task in '${task.status}' state` }, { status: 409 });
    }
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
    if (task.status !== 'plan_review' && task.status !== 'pending') {
      return NextResponse.json({ error: `Cannot approve task in '${task.status}' state` }, { status: 409 });
    }
    const updates: Record<string, any> = {
      status: 'coding',
      updatedAt: new Date().toISOString(),
    };
    if (editedPlan) {
      updates.plan = JSON.stringify(editedPlan);
    }
    db.update(tasks).set(updates).where(eq(tasks.id, id)).run();
    return NextResponse.json({ success: true, action: 'approved' });
  }

  if (action === 'reject') {
    if (terminalStatuses.includes(task.status)) {
      return NextResponse.json({ error: `Cannot reject task in '${task.status}' state` }, { status: 409 });
    }
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
