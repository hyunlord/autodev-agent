import { db } from '@/lib/db/client';
import { tasks, attempts } from '@/lib/db/schema';
import { gte, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString();

  const todayTasks = db.select().from(tasks)
    .where(gte(tasks.createdAt, todayStr))
    .all();

  const completed = todayTasks.filter(t => t.status === 'completed').length;
  const failed = todayTasks.filter(t => t.status === 'failed').length;
  const running = todayTasks.filter(t =>
    ['planning', 'coding', 'verifying', 'retrying'].includes(t.status)
  ).length;

  const costResult = db.select({
    totalCost: sql<number>`sum(${attempts.costUsd})`,
  }).from(attempts)
    .where(gte(attempts.createdAt, todayStr))
    .get();

  return NextResponse.json({
    today: {
      total: todayTasks.length,
      completed,
      failed,
      running,
      successRate: todayTasks.length > 0 ? Math.round(completed / todayTasks.length * 100) : 0,
      totalCost: costResult?.totalCost ?? 0,
    },
  });
}
