import { db } from '@/lib/db/client';
import { tasks } from '@/lib/db/schema';
import { desc, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

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
