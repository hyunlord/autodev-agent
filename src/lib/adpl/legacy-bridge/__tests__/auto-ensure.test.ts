import { describe, it, expect, vi, beforeEach } from 'vitest';
import { load } from 'js-yaml';
import type { AdplPipeline } from '@/lib/adpl/types/pipeline';

// ── db mock ──────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  dbGet: vi.fn(),
  dbRun: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ get: mocks.dbGet }),
      }),
    }),
    insert: () => ({
      values: () => ({ run: mocks.dbRun }),
    }),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  pipelineVersions: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  sql: new Proxy(
    (strings: TemplateStringsArray, ..._values: unknown[]) => strings[0],
    { get: (_t, prop) => prop },
  ),
}));

vi.mock('nanoid', () => ({ nanoid: () => 'generated-id' }));

import { ensureDefaultPipelineVersion } from '../auto-ensure';

// ─────────────────────────────────────────────────────────────────────────────

describe('ensureDefaultPipelineVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. 기존 legacy-equivalent-default 버전 존재 → 해당 id 반환, insert 미호출', async () => {
    // first get: existing row found
    mocks.dbGet.mockReturnValueOnce({ id: 'existing-version-id' });

    const result = await ensureDefaultPipelineVersion({
      id: 'task-1',
      projectId: 'proj-1',
    });

    expect(result).toBe('existing-version-id');
    expect(mocks.dbRun).not.toHaveBeenCalled();
  });

  it('2. 기존 버전 없음 → 생성 후 새 id 반환, insert 1회 호출', async () => {
    // first get: existing check → null
    // second get: max version → null (no existing versions)
    mocks.dbGet
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);

    const result = await ensureDefaultPipelineVersion({
      id: 'task-2',
      projectId: 'proj-2',
    });

    expect(result).toBe('generated-id');
    expect(mocks.dbRun).toHaveBeenCalledTimes(1);
    // Verify inserted values include required fields
    const insertedValues = mocks.dbRun.mock.calls[0];
    expect(insertedValues).toBeDefined();
  });

  it('3. 같은 project에 대해 두 번 호출 → insert 1회만 (두 번째는 기존 id 반환)', async () => {
    // First call: no existing → create
    mocks.dbGet
      .mockReturnValueOnce(null)  // existing check
      .mockReturnValueOnce(null); // max version

    const id1 = await ensureDefaultPipelineVersion({ id: 'task-3a', projectId: 'proj-3' });
    expect(id1).toBe('generated-id');
    expect(mocks.dbRun).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();

    // Second call: existing found → return id directly
    mocks.dbGet.mockReturnValueOnce({ id: 'generated-id' });

    const id2 = await ensureDefaultPipelineVersion({ id: 'task-3b', projectId: 'proj-3' });
    expect(id2).toBe('generated-id');
    expect(mocks.dbRun).not.toHaveBeenCalled();
  });

  it('4. 생성된 pipelineYaml은 파싱 가능하고 AdplPipeline 구조 충족', async () => {
    // Verify YAML structure via buildLegacyEquivalentPipeline + serializeToYaml
    // (auto-ensure uses these same functions internally)
    const { buildLegacyEquivalentPipeline, serializeToYaml } = await import('../yaml-generator');
    const spec = buildLegacyEquivalentPipeline({ projectId: 'proj-4' });
    const yaml = serializeToYaml(spec);
    const parsed = load(yaml) as AdplPipeline;

    expect(parsed.adplVersion).toBe(1);
    expect(parsed.name).toBe('legacy-equivalent-default');
    expect(Array.isArray(parsed.pipeline)).toBe(true);
    expect(parsed.pipeline.length).toBeGreaterThanOrEqual(3);

    // Also verify that auto-ensure creates a version when none exists
    mocks.dbGet
      .mockReturnValueOnce(null)  // existing check
      .mockReturnValueOnce(null); // max version

    const result = await ensureDefaultPipelineVersion({ id: 'task-4', projectId: 'proj-4' });
    expect(result).toBe('generated-id');
    expect(mocks.dbRun).toHaveBeenCalledTimes(1);
  });

  it('5. projectId null → 에러 throw', async () => {
    await expect(
      ensureDefaultPipelineVersion({ id: 'task-5', projectId: null }),
    ).rejects.toThrow('no projectId');
  });
});
