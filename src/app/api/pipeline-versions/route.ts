import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { projects } from '@/lib/db/schema';
import { validateYaml } from '@/lib/utils/yaml-validate';
import { createPipelineVersion } from '@/lib/db/queries/pipeline-versions';

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await req.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return Response.json({ error: 'INVALID_BODY' }, { status: 400 });
    }
    body = raw as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const { projectId, yaml, changeSource } = body;

  if (!projectId || typeof projectId !== 'string' || typeof yaml !== 'string') {
    return Response.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) {
    return Response.json({ error: 'PROJECT_NOT_FOUND' }, { status: 404 });
  }

  const validation = validateYaml(yaml);
  if (!validation.ok) {
    return Response.json(
      { error: 'YAML_VALIDATION_FAILED', message: validation.error },
      { status: 400 },
    );
  }

  const result = createPipelineVersion({
    projectId,
    pipelineYaml: yaml,
    changeSource: changeSource as 'manual' | 'ai_edit' | 'evolve' | 'wizard' | 'preset' | 'rollback' | undefined,
  });
  return Response.json({ data: result });
}
