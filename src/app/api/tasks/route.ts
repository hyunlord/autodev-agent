import { db } from '@/lib/db/client';
import { tasks } from '@/lib/db/schema';
import { WorkerManager } from '@/lib/worker-manager';
import { nanoid } from 'nanoid';
import { desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const result = await db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(limit).offset(offset);
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { prompt, projectDir } = body;

  if (!prompt || typeof prompt !== 'string') {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const task = {
    id: nanoid(),
    prompt,
    status: 'pending' as const,
    projectDir: projectDir ?? null,
    projectType: null,
    config: null,
    result: null,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(tasks).values(task).run();

  WorkerManager.instance.dispatch(task.id);

  return NextResponse.json(task, { status: 201 });
}
