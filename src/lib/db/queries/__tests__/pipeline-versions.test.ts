import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { pipelineVersions, projects } from '@/lib/db/schema';
import { createPipelineVersion, getNextVersionNumber } from '../pipeline-versions';

const PROJECT_A = 'pv-proj-a';
const PROJECT_B = 'pv-proj-b';

const TEST_YAML =
  'adplVersion: 1\nname: test-pipe\npipeline:\n  - id: s1\n    type: shell\n    command: echo hi\n';

function seedProject(id: string) {
  db.insert(projects)
    .values({
      id,
      name: id,
      path: `/tmp/${id}`,
      description: null,
      icon: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();
}

describe('queries/pipeline-versions', () => {
  beforeEach(() => {
    db.delete(pipelineVersions).run();
    seedProject(PROJECT_A);
    seedProject(PROJECT_B);
  });

  it('first version → versionNumber=1', () => {
    const result = createPipelineVersion({ projectId: PROJECT_A, pipelineYaml: TEST_YAML });
    expect(result.versionNumber).toBe(1);
    expect(result.id).toBeTruthy();
  });

  it('second version for same project → versionNumber=2', () => {
    createPipelineVersion({ projectId: PROJECT_A, pipelineYaml: TEST_YAML });
    const result = createPipelineVersion({ projectId: PROJECT_A, pipelineYaml: TEST_YAML });
    expect(result.versionNumber).toBe(2);
  });

  it('different projectId → each starts at versionNumber=1', () => {
    const a = createPipelineVersion({ projectId: PROJECT_A, pipelineYaml: TEST_YAML });
    const b = createPipelineVersion({ projectId: PROJECT_B, pipelineYaml: TEST_YAML });
    expect(a.versionNumber).toBe(1);
    expect(b.versionNumber).toBe(1);
  });

  it('getNextVersionNumber: returns 1 when no versions exist', () => {
    expect(getNextVersionNumber(PROJECT_A)).toBe(1);
  });
});
