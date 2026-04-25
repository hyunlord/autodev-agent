import { eq, max } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db/client';
import { pipelineVersions } from '@/lib/db/schema';

export function getNextVersionNumber(projectId: string): number {
  const result = db
    .select({ max: max(pipelineVersions.versionNumber) })
    .from(pipelineVersions)
    .where(eq(pipelineVersions.projectId, projectId))
    .get();
  return (result?.max ?? 0) + 1;
}

export function createPipelineVersion(input: {
  projectId: string;
  pipelineYaml: string;
  changedBy?: string;
}): { id: string; versionNumber: number } {
  const versionNumber = getNextVersionNumber(input.projectId);
  const id = nanoid();
  db.insert(pipelineVersions).values({
    id,
    projectId: input.projectId,
    versionNumber,
    pipelineYaml: input.pipelineYaml,
    adplVersion: '1.0',
    changeSource: 'manual',
    changedBy: input.changedBy ?? null,
    changeDescription: null,
    createdAt: new Date().toISOString(),
  }).run();
  return { id, versionNumber };
}
