import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  runLegacyPipeline: vi.fn<() => Promise<void>>(),
  executorRun: vi.fn(),
  dbGet: vi.fn(),
  busOn: vi.fn(),
  ensureDefaultPipelineVersion: vi.fn<() => Promise<string>>(),
  recordComparison: vi.fn<() => Promise<void>>(),
}));

vi.mock('./pipeline', () => ({
  runLegacyPipeline: mocks.runLegacyPipeline,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ get: mocks.dbGet }) }) }),
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
vi.mock('@/lib/db/schema', () => ({ tasks: {}, pipelineVersions: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
vi.mock('nanoid', () => ({ nanoid: () => 'test-id' }));
vi.mock('@/lib/adpl/legacy-bridge', () => ({
  ensureDefaultPipelineVersion: mocks.ensureDefaultPipelineVersion,
}));
vi.mock('./shadow-comparator', () => ({
  recordComparison: mocks.recordComparison,
}));

import { runShadow } from './shadow-runner';

const baseTask = {
  id: 'task-1',
  pipelineMode: 'shadow' as const,
  pipelineVersionId: 'v1' as string | null,
  projectId: 'proj-1',
  projectDir: '/tmp/test',
  status: 'pending' as const,
  prompt: 'test',
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
} as Parameters<typeof runShadow>[0];

describe('shadow-runner', () => {
  const rawEmit = vi.fn();
  const emit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runLegacyPipeline.mockResolvedValue(undefined);
    mocks.executorRun.mockResolvedValue({ status: 'completed' });
    mocks.dbGet.mockReturnValue({ id: 'v1', pipelineYaml: 'adplVersion: 1\nname: test\n' });
    mocks.recordComparison.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('1. legacy 성공 + shadow 성공 → comparator에 ok=true 양쪽 기록', async () => {
    await runShadow(baseTask, rawEmit, emit);

    expect(mocks.recordComparison).toHaveBeenCalledWith(
      'task-1',
      'proj-1',
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true, finalStatus: 'completed' }),
    );
    expect(mocks.runLegacyPipeline).toHaveBeenCalledWith('task-1', rawEmit, undefined);
  });

  test('2. legacy 성공 + shadow 실패 → legacy ok, comparator에 shadow.ok=false', async () => {
    mocks.executorRun.mockRejectedValue(new Error('executor crashed'));

    await runShadow(baseTask, rawEmit, emit);

    expect(mocks.recordComparison).toHaveBeenCalledWith(
      'task-1',
      'proj-1',
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: false, error: 'executor crashed' }),
    );
  });

  test('3. legacy 실패 → legacyResult.ok=false, runShadow 자체는 resolve', async () => {
    mocks.runLegacyPipeline.mockRejectedValue(new Error('legacy boom'));

    await expect(runShadow(baseTask, rawEmit, emit)).resolves.toBeUndefined();

    expect(mocks.recordComparison).toHaveBeenCalledWith(
      'task-1',
      'proj-1',
      expect.objectContaining({ ok: false, error: 'legacy boom' }),
      expect.anything(),
    );
  });

  test('4. shadow 늘어짐 → 30초 abort 후 shadow.ok=false', async () => {
    vi.useFakeTimers();
    // executor never resolves
    mocks.executorRun.mockReturnValue(new Promise<never>(() => {}));

    const runPromise = runShadow(baseTask, rawEmit, emit);
    await vi.runAllTimersAsync();
    await runPromise;

    expect(mocks.recordComparison).toHaveBeenCalledWith(
      'task-1',
      'proj-1',
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: false, error: expect.stringContaining('aborted') }),
    );
  });

  test('5. shadow 실패해도 runShadow는 항상 resolve (legacy 결과 독립)', async () => {
    mocks.executorRun.mockRejectedValue(new Error('shadow kaboom'));

    // Must not throw — legacy success is preserved
    await expect(runShadow(baseTask, rawEmit, emit)).resolves.toBeUndefined();
    expect(mocks.runLegacyPipeline).toHaveBeenCalled();
  });

  test('6. pipelineVersionId null → shadow 내 ensureDefaultPipelineVersion 호출', async () => {
    const taskNoVersion = { ...baseTask, pipelineVersionId: null };
    mocks.ensureDefaultPipelineVersion.mockResolvedValue('auto-v');
    mocks.dbGet.mockReturnValue({ id: 'auto-v', pipelineYaml: 'adplVersion: 1\nname: auto\n' });

    await runShadow(taskNoVersion, rawEmit, emit);

    expect(mocks.ensureDefaultPipelineVersion).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-1' }),
    );
    expect(mocks.executorRun).toHaveBeenCalled();
  });
});
