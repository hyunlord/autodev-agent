import { db } from '@/lib/db/client';
import { tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

// GET — 현재 질문 목록 가져오기
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const config = typeof task.config === 'string' ? JSON.parse(task.config) : task.config ?? {};
  return NextResponse.json({
    questions: config.interviewQuestions ?? [],
    answers: config.interviewAnswers ?? {},
    status: task.status,
  });
}

// POST — 답변 제출 → Planning 시작
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { answers } = body;

  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const config = typeof task.config === 'string' ? JSON.parse(task.config) : task.config ?? {};
  config.interviewAnswers = answers;

  // Build enriched prompt from original + answers
  const questions: string[] = config.interviewQuestions ?? [];
  const qaSection = questions.map((q, i) => {
    const answer = (answers as Record<string | number, string>)[i]
      ?? (answers as Record<string | number, string>)[String(i)]
      ?? '(no answer)';
    return `Q: ${q}\nA: ${answer}`;
  }).join('\n\n');

  const hasAnswers = Object.keys(answers ?? {}).length > 0;
  const enrichedPrompt = hasAnswers
    ? `${task.prompt}\n\n## Clarifications from user:\n${qaSection}`
    : task.prompt;

  db.update(tasks).set({
    config: JSON.stringify(config),
    prompt: enrichedPrompt,
    status: 'pending',
    updatedAt: new Date().toISOString(),
  }).where(eq(tasks.id, id)).run();

  // Dispatch to worker
  const { WorkerManager } = await import('@/lib/worker-manager');
  WorkerManager.instance.dispatch(id);

  return NextResponse.json({ success: true, enrichedPrompt: enrichedPrompt.slice(0, 500) });
}
