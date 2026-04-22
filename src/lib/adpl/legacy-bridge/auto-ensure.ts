import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db/client';
import { pipelineVersions } from '@/lib/db/schema';
import { buildLegacyEquivalentPipeline, serializeToYaml } from './yaml-generator';

/**
 * 주어진 task의 project에 대해 'legacy-equivalent-default' 파이프라인 버전이
 * 이미 존재하면 그 id를 반환하고, 없으면 생성 후 id를 반환.
 *
 * 멱등성 조건: changeSource='preset' AND changeDescription='legacy-equivalent-default'
 */
export async function ensureDefaultPipelineVersion(
  task: { id: string; projectId: string | null },
): Promise<string> {
  if (!task.projectId) {
    throw new Error(
      `Cannot create pipeline version: task ${task.id} has no projectId`,
    );
  }

  // 기존 legacy-equivalent-default 버전 확인
  const existing = await db
    .select({ id: pipelineVersions.id })
    .from(pipelineVersions)
    .where(
      and(
        eq(pipelineVersions.projectId, task.projectId),
        eq(pipelineVersions.changeSource, 'preset'),
        eq(pipelineVersions.changeDescription, 'legacy-equivalent-default'),
      ),
    )
    .get();

  if (existing) return existing.id;

  // 이 project 내 최대 versionNumber 조회 → +1
  const maxResult = await db
    .select({ maxVer: sql<number>`max(${pipelineVersions.versionNumber})` })
    .from(pipelineVersions)
    .where(eq(pipelineVersions.projectId, task.projectId))
    .get();
  const nextVersion = (maxResult?.maxVer ?? 0) + 1;

  // YAML 생성
  const spec = buildLegacyEquivalentPipeline({ projectId: task.projectId });
  const yaml = serializeToYaml(spec);

  const id = nanoid();
  await db
    .insert(pipelineVersions)
    .values({
      id,
      projectId: task.projectId,
      versionNumber: nextVersion,
      pipelineYaml: yaml,
      adplVersion: '1.0',
      changeSource: 'preset',
      changeDescription: 'legacy-equivalent-default',
      changedBy: 'system',
      createdAt: new Date().toISOString(),
    })
    .run();

  return id;
}
