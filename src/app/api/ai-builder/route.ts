import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { projects } from '@/lib/db/schema';
import { AIBuilderOrchestrator } from '@/lib/ai-builder/orchestrator';

const ConversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const RequestSchema = z.object({
  projectId: z.string().min(1),
  userMessage: z.string().min(1),
  currentYaml: z.string().optional(),
  conversationHistory: z.array(ConversationTurnSchema).optional(),
});

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return Response.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, parsed.data.projectId))
    .get();
  if (!project) {
    return Response.json({ error: 'PROJECT_NOT_FOUND' }, { status: 404 });
  }

  try {
    const orchestrator = new AIBuilderOrchestrator();
    const result = await orchestrator.run(parsed.data);
    return Response.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: 'AI_BUILDER_FAILED', message }, { status: 500 });
  }
}
