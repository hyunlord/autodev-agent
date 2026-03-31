import { db } from '@/lib/db/client';
import { tasks, attempts, events, verifications } from '@/lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { rmSync, existsSync } from 'fs';
import { resolve } from 'path';

export async function GET() {
  const projects = db
    .select({
      projectDir: tasks.projectDir,
      taskCount: sql<number>`count(*)`,
      latestTask: sql<string>`max(${tasks.updatedAt})`,
      completedCount: sql<number>`sum(case when ${tasks.status} = 'completed' then 1 else 0 end)`,
      failedCount: sql<number>`sum(case when ${tasks.status} in ('failed', 'escalated') then 1 else 0 end)`,
    })
    .from(tasks)
    .where(sql`${tasks.projectDir} is not null`)
    .groupBy(tasks.projectDir)
    .orderBy(desc(sql`max(${tasks.updatedAt})`))
    .all();

  return NextResponse.json(projects);
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
