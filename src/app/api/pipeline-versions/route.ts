import { validateYaml } from '@/lib/utils/yaml-validate';
import { createPipelineVersion } from '@/lib/db/queries/pipeline-versions';

export async function POST(req: Request) {
  const body = await req.json() as Record<string, unknown>;
  const { projectId, yaml } = body;

  if (!projectId || typeof projectId !== 'string' || typeof yaml !== 'string') {
    return Response.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const validation = validateYaml(yaml);
  if (!validation.ok) {
    return Response.json(
      { error: 'YAML_VALIDATION_FAILED', message: validation.error },
      { status: 400 },
    );
  }

  const result = createPipelineVersion({ projectId, pipelineYaml: yaml });
  return Response.json({ data: result });
}
