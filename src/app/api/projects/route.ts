import { db } from '@/lib/db/client';
import { tasks, attempts, events, verifications, projects } from '@/lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { rmSync, existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { nanoid } from 'nanoid';
import { z } from 'zod';

export async function GET() {
  const projects = db
    .select({
      projectDir: tasks.projectDir,
      taskCount: sql<number>`count(*)`,
      latestTask: sql<string>`max(${tasks.updatedAt})`,
      completedCount: sql<number>`sum(case when ${tasks.status} = 'completed' then 1 else 0 end)`,
      failedCount: sql<number>`sum(case when ${tasks.status} in ('failed', 'escalated') then 1 else 0 end)`,
      runningCount: sql<number>`sum(case when ${tasks.status} in ('planning', 'coding', 'verifying', 'retrying') then 1 else 0 end)`,
    })
    .from(tasks)
    .where(sql`${tasks.projectDir} is not null`)
    .groupBy(tasks.projectDir)
    .orderBy(desc(sql`max(${tasks.updatedAt})`))
    .all();

  const enriched = projects.map(p => {
    let projectName: string | null = null;
    let projectType: string | null = null;
    if (p.projectDir) {
      const nameFile = join(p.projectDir, '.autodev', 'project-name.txt');
      if (existsSync(nameFile)) {
        try { projectName = readFileSync(nameFile, 'utf-8').trim(); } catch {}
      }
    }

    // Get totalCost from attempts
    const costResult = db.select({
      total: sql<number>`coalesce(sum(${attempts.costUsd}), 0)`,
    }).from(attempts)
      .innerJoin(tasks, eq(attempts.taskId, tasks.id))
      .where(eq(tasks.projectDir, p.projectDir!))
      .get();

    // Get projectType from the latest task
    const latestTaskRow = db.select({ projectType: tasks.projectType })
      .from(tasks)
      .where(eq(tasks.projectDir, p.projectDir!))
      .orderBy(desc(tasks.updatedAt))
      .limit(1)
      .get();
    projectType = latestTaskRow?.projectType ?? null;

    return {
      ...p,
      projectName,
      projectType,
      totalCost: costResult?.total ?? 0,
    };
  });

  return NextResponse.json(enriched);
}

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  path: z.string().min(1).max(500),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = CreateProjectSchema.parse(body);

    const normalizedPath = resolve(data.path);

    const existing = db.select({ id: projects.id })
      .from(projects)
      .where(eq(projects.path, normalizedPath))
      .limit(1)
      .get();
    if (existing) {
      return NextResponse.json(
        { error: 'A project with this path already exists' },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const created = db.insert(projects).values({
      id: nanoid(),
      name: data.name,
      path: normalizedPath,
      description: data.description ?? null,
      icon: data.icon ?? null,
      createdAt: now,
      updatedAt: now,
    }).returning().get();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.errors }, { status: 400 });
    }
    console.error('Create project error:', err);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const dir = url.searchParams.get('dir');

  if (!dir) return NextResponse.json({ error: 'dir required' }, { status: 400 });

  // Find all tasks for this project
  const projectTasks = db.select({ id: tasks.id }).from(tasks)
    .where(eq(tasks.projectDir, dir)).all();

  // Delete related records for each task
  for (const t of projectTasks) {
    db.delete(verifications).where(sql`${verifications.attemptId} IN (SELECT id FROM attempts WHERE task_id = ${t.id})`).run();
    db.delete(attempts).where(eq(attempts.taskId, t.id)).run();
    db.delete(events).where(eq(events.taskId, t.id)).run();
    db.delete(tasks).where(eq(tasks.id, t.id)).run();
  }

  // Only delete workspace folder if it's inside .autodev/workspaces/
  const resolved = resolve(dir);
  if (resolved.includes('.autodev/workspaces/') && existsSync(resolved)) {
    try { rmSync(resolved, { recursive: true, force: true }); } catch {}
  }

  return NextResponse.json({ deleted: true, taskCount: projectTasks.length });
}
