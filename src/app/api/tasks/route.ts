import { db } from '@/lib/db/client';
import { tasks } from '@/lib/db/schema';
import { WorkerManager } from '@/lib/worker-manager';
import { nanoid } from 'nanoid';
import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
  const projectDir = url.searchParams.get('projectDir') || null;

  const result = await db.select({
    id: tasks.id,
    prompt: tasks.prompt,
    status: tasks.status,
    agentId: tasks.agentId,
    projectDir: tasks.projectDir,
    executionMode: tasks.executionMode,
    cycleCount: tasks.cycleCount,
    maxCycles: tasks.maxCycles,
    result: tasks.result,
    parentTaskId: tasks.parentTaskId,
    createdAt: tasks.createdAt,
    updatedAt: tasks.updatedAt,
  }).from(tasks)
    .where(projectDir ? eq(tasks.projectDir, projectDir) : undefined)
    .orderBy(desc(tasks.createdAt))
    .limit(limit)
    .offset(offset);
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
    if (!body || typeof body !== 'object') throw new Error();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { prompt } = body;
  if (!prompt || typeof prompt !== 'string') {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }

  const projectDir = typeof body.projectDir === 'string' && body.projectDir.trim()
    ? body.projectDir.trim()
    : null;
  const parentTaskId: string | null = typeof body.parentTaskId === 'string' ? body.parentTaskId : null;

  const now = new Date().toISOString();
  const task = {
    id: nanoid(),
    prompt,
    status: 'pending' as const,
    planningMode: body.planningMode ?? 'auto',
    agentId: body.agentId ?? 'claude-code',
    projectDir,
    projectType: null,
    plan: null,
    systemPrompt: body.systemPrompt ?? null,
    executionMode: body.executionMode ?? 'single',
    cycleCount: 0,
    maxCycles: body.maxCycles ?? 10,
    config: JSON.stringify({
      codingPrompt: body.codingPrompt ?? null,
      verificationChecklist: body.verificationChecklist ?? null,
      autoApprove: body.autoApprove ?? false,
      ...(body.costPreference ? { costPreference: body.costPreference } : {}),
    }),
    result: null,
    parentTaskId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    db.insert(tasks).values(task).run();
  } catch (err) {
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }

  try {
    WorkerManager.instance.dispatch(task.id);
  } catch {
    // Task created but dispatch failed — worker will pick it up on next poll
  }

  return NextResponse.json(task, { status: 201 });
}
