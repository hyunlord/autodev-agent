import { describe, test, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  runLegacyPipeline: vi.fn<() => Promise<void>>(),
  executorRun: vi.fn(),
  dbGet: vi.fn(),
  dbRun: vi.fn(),
  busOn: vi.fn(),
  ensureDefaultPipelineVersion: vi.fn<() => Promise<string>>(),
}));

vi.mock('./pipeline', () => ({
  runLegacyPipeline: mocks.runLegacyPipeline,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ get: mocks.dbGet }) }) }),
    insert: () => ({ values: () => ({ run: mocks.dbRun }) }),
    update: () => ({ set: () => ({ where: () => ({ run: mocks.dbRun }) }) }),
  },
}));

vi.mock('@/lib/adpl/engine/executor', () => ({
  PipelineExecutor: class {
    run = mocks.executorRun;
  },
}));

vi.mock('@/lib/adpl/engine/compiler', () => ({ PipelineCompiler: vi.fn() }));
vi.mock('@/lib/adpl/engine/state/store', () => ({ StateStore: vi.fn() }));
vi.mock('@/lib/adpl/engine/events/bus', () => ({
  EventBus: class {
    on = mocks.busOn;
  },
}));
vi.mock('@/lib/adpl/engine/adapters/registry', () => ({ AdapterRegistry: vi.fn() }));
vi.mock('@/lib/db/schema', () => ({ tasks: {}, events: {}, pipelineVersions: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
vi.mock('nanoid', () => ({ nanoid: () => 'test-id' }));
vi.mock('@/lib/adpl/legacy-bridge', () => ({
  ensureDefaultPipelineVersion: mocks.ensureDefaultPipelineVersion,
}));

import { runPipeline } from './pipeline-facade';

const baseTask = {
  id: 'task-1',
  pipelineMode: 'legacy',
  pipelineVersionId: null as string | null,
  projectId: 'proj-1',
  projectDir: '/tmp/test',
  status: 'pending',
  updatedAt: new Date().toISOString(),
};

describe('pipeline facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runLegacyPipeline.mockResolvedValue(undefined);
    mocks.executorRun.mockResolvedValue({
      status: 'completed',
      completedNodes: 1,
      failedNodes: 0,
    });
  });

  test('pipeline_mode === legacy → runLegacyPipeline 호출', async () => {
    mocks.dbGet.mockReturnValue({ ...baseTask, pipelineMode: 'legacy' });
    const emit = vi.fn();
    await runPipeline('task-1', emit);
    expect(mocks.runLegacyPipeline).toHaveBeenCalledWith('task-1', emit, undefined);
    expect(mocks.executorRun).not.toHaveBeenCalled();
  });

  test('pipeline_mode 누락(null) → legacy 기본값 적용', async () => {
    mocks.dbGet.mockReturnValue({ ...baseTask, pipelineMode: null });
    const emit = vi.fn();
    await runPipeline('task-1', emit);
    expect(mocks.runLegacyPipeline).toHaveBeenCalledWith('task-1', emit, undefined);
    expect(mocks.executorRun).not.toHaveBeenCalled();
  });

  test('pipeline_mode === phase_p + pipelineVersionId 존재 → PipelineExecutor.run 호출', async () => {
    mocks.dbGet
      .mockReturnValueOnce({ ...baseTask, pipelineMode: 'phase_p', pipelineVersionId: 'v1' })
      .mockReturnValueOnce({ id: 'v1', pipelineYaml: 'adplVersion: 1\nname: test\n' });
    const emit = vi.fn();
    await runPipeline('task-1', emit);
    expect(mocks.executorRun).toHaveBeenCalled();
    expect(mocks.runLegacyPipeline).not.toHaveBeenCalled();
  });

  test('pipeline_mode === phase_p + pipelineVersionId null → ensureDefaultPipelineVersion 호출 후 PipelineExecutor.run 실행', async () => {
    mocks.ensureDefaultPipelineVersion.mockResolvedValue('auto-version-id');
    mocks.dbGet
      .mockReturnValueOnce({ ...baseTask, pipelineMode: 'phase_p', pipelineVersionId: null })
      .mockReturnValueOnce({ id: 'auto-version-id', pipelineYaml: 'adplVersion: 1\nname: legacy-equivalent-default\n' });
    const emit = vi.fn();
    await runPipeline('task-1', emit);
    expect(mocks.ensureDefaultPipelineVersion).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-1', projectId: 'proj-1' }),
    );
    expect(mocks.dbRun).toHaveBeenCalled(); // tasks update
    expect(mocks.executorRun).toHaveBeenCalled();
    expect(mocks.runLegacyPipeline).not.toHaveBeenCalled();
  });

  test('pipeline_mode === shadow → SHADOW_MODE_NOT_IMPLEMENTED 에러', async () => {
    mocks.dbGet.mockReturnValue({ ...baseTask, pipelineMode: 'shadow' });
    const emits: Array<{ type: string; message?: string }> = [];
    await runPipeline('task-1', (e) => emits.push(e as { type: string; message?: string }));
    expect(mocks.executorRun).not.toHaveBeenCalled();
    expect(mocks.runLegacyPipeline).not.toHaveBeenCalled();
    expect(emits.some((e) => e.message?.includes('SHADOW_MODE_NOT_IMPLEMENTED'))).toBe(true);
  });

  test('pipeline_mode === unknown → UNKNOWN_PIPELINE_MODE 에러', async () => {
    mocks.dbGet.mockReturnValue({ ...baseTask, pipelineMode: 'unexpected_mode' });
    const emits: Array<{ type: string; message?: string }> = [];
    await runPipeline('task-1', (e) => emits.push(e as { type: string; message?: string }));
    expect(mocks.executorRun).not.toHaveBeenCalled();
    expect(mocks.runLegacyPipeline).not.toHaveBeenCalled();
    expect(emits.some((e) => e.message?.includes('UNKNOWN_PIPELINE_MODE'))).toBe(true);
  });
});
