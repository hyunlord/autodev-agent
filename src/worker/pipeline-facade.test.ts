import { describe, test, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  runLegacyPipeline: vi.fn<() => Promise<void>>(),
  runShadow: vi.fn<() => Promise<void>>(),
  executorRun: vi.fn(),
  executorResumeRun: vi.fn(),
  dbGet: vi.fn(),
  dbRun: vi.fn(),
  busOn: vi.fn(),
  ensureDefaultPipelineVersion: vi.fn<() => Promise<string>>(),
  stateStoreRestore: vi.fn(),
  storeGet: vi.fn(),
}));

vi.mock('./pipeline', () => ({
  runLegacyPipeline: mocks.runLegacyPipeline,
}));

vi.mock('./shadow-runner', () => ({
  runShadow: mocks.runShadow,
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
    resumeRun = mocks.executorResumeRun;
  },
}));

vi.mock('@/lib/adpl/engine/compiler', () => ({ PipelineCompiler: vi.fn() }));
vi.mock('@/lib/adpl/engine/state/store', () => ({
  StateStore: Object.assign(
    class {
      get = mocks.storeGet;
    },
    { restore: mocks.stateStoreRestore },
  ),
}));
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

import { runPipeline, resumePhasePPipeline } from './pipeline-facade';

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
    mocks.runShadow.mockResolvedValue(undefined);
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

  test('pipeline_mode === shadow → runShadow 호출 (stub 에러 없음)', async () => {
    mocks.dbGet.mockReturnValue({ ...baseTask, pipelineMode: 'shadow' });
    const emit = vi.fn();
    await runPipeline('task-1', emit);
    expect(mocks.runShadow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-1', pipelineMode: 'shadow' }),
      emit,
      expect.any(Function),
      undefined,
    );
    expect(mocks.runLegacyPipeline).not.toHaveBeenCalled();
    expect(mocks.executorRun).not.toHaveBeenCalled();
  });

  test('runPhasePPipeline: ensureDefault throw → ENSURE_DEFAULT_FAILED emit + failTask DB update', async () => {
    mocks.ensureDefaultPipelineVersion.mockRejectedValue(new Error('no projectId'));
    mocks.dbGet.mockReturnValue({ ...baseTask, pipelineMode: 'phase_p', pipelineVersionId: null });
    const emits: Array<{ type: string; message?: string }> = [];
    await runPipeline('task-1', (e) => emits.push(e as { type: string; message?: string }));
    expect(emits.some((e) => e.message?.includes('ENSURE_DEFAULT_FAILED'))).toBe(true);
    expect(mocks.dbRun).toHaveBeenCalled();
  });

  test('runPhasePPipeline: async throw → unhandled rejection 없이 resolve', async () => {
    mocks.ensureDefaultPipelineVersion.mockRejectedValue(new Error('unexpected'));
    mocks.dbGet.mockReturnValue({ ...baseTask, pipelineMode: 'phase_p', pipelineVersionId: null });
    await expect(runPipeline('task-1', vi.fn())).resolves.toBeUndefined();
  });

  test('runPhasePPipeline: executor.run throw → PHASE_P_EXECUTOR_FAILED (ENSURE_DEFAULT_FAILED 아님)', async () => {
    mocks.executorRun.mockRejectedValue(new Error('executor boom'));
    mocks.dbGet
      .mockReturnValueOnce({ ...baseTask, pipelineMode: 'phase_p', pipelineVersionId: 'v1' })
      .mockReturnValueOnce({ id: 'v1', pipelineYaml: 'adplVersion: 1\nname: test\n' });
    const emits: Array<{ type: string; message?: string }> = [];
    await runPipeline('task-1', (e) => emits.push(e as { type: string; message?: string }));
    expect(emits.some((e) => e.message?.includes('PHASE_P_EXECUTOR_FAILED'))).toBe(true);
    expect(emits.every((e) => !e.message?.includes('ENSURE_DEFAULT_FAILED'))).toBe(true);
    expect(mocks.dbRun).toHaveBeenCalled();
  });

  test('runPhasePPipeline: version null → PHASE_P_PIPELINE_VERSION_NOT_FOUND + failTask', async () => {
    mocks.dbGet
      .mockReturnValueOnce({ ...baseTask, pipelineMode: 'phase_p', pipelineVersionId: 'v-missing' })
      .mockReturnValueOnce(null);
    const emits: Array<{ type: string; message?: string }> = [];
    await runPipeline('task-1', (e) => emits.push(e as { type: string; message?: string }));
    expect(emits.some((e) => e.message?.includes('PHASE_P_PIPELINE_VERSION_NOT_FOUND'))).toBe(true);
    expect(mocks.executorRun).not.toHaveBeenCalled();
    expect(mocks.dbRun).toHaveBeenCalled();
  });

  test('runPhasePPipeline: fetchVersion throw → PHASE_P_PIPELINE_VERSION_FETCH_FAILED + failTask', async () => {
    mocks.dbGet
      .mockReturnValueOnce({ ...baseTask, pipelineMode: 'phase_p', pipelineVersionId: 'v-throw' })
      .mockImplementationOnce(() => { throw new Error('DB connection lost'); });
    const emits: Array<{ type: string; message?: string }> = [];
    await runPipeline('task-1', (e) => emits.push(e as { type: string; message?: string }));
    expect(emits.some((e) => e.message?.includes('PHASE_P_PIPELINE_VERSION_FETCH_FAILED'))).toBe(true);
    expect(emits.some((e) => e.message?.includes('DB connection lost'))).toBe(true);
    expect(mocks.executorRun).not.toHaveBeenCalled();
    expect(mocks.dbRun).toHaveBeenCalled();
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

// ─────────────────────────────────────────────────────────────────────────────
// Stage 6 F3 — resumePhasePPipeline
// ─────────────────────────────────────────────────────────────────────────────
describe('resumePhasePPipeline (Stage 6 F3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executorResumeRun.mockResolvedValue({
      runId: 'run-1',
      pipelineVersionId: 'v1',
      status: 'completed',
      completedNodes: 3,
      failedNodes: 0,
      skippedNodes: 0,
      cancelledNodes: 0,
      totalDurationMs: 1,
      compileDurationMs: 0,
      executionDurationMs: 1,
    });
  });

  test('1. 정상 resume: StateStore.restore → tasks 업데이트 + executor.resumeRun 호출', async () => {
    mocks.stateStoreRestore.mockResolvedValueOnce({
      get: () => Promise.resolve({
        id: 'run-1',
        taskId: 'task-R1',
        pipelineVersionId: 'v-R1',
        triggerContext: { triggerId: 'x', type: 'task_created', firedAt: '...' },
        worktreeRoot: '/tmp/wt',
        nodes: new Map(),
        flowStates: new Map(),
      }),
    });
    // task row + pipelineVersion row
    mocks.dbGet
      .mockReturnValueOnce({ id: 'task-R1', pipelineVersionId: 'v-R1', resumeCount: 0 })  // task lookup for versionId
      .mockReturnValueOnce({ id: 'v-R1', pipelineYaml: 'adplVersion: 1\nname: r\n' })      // pipelineVersion
      .mockReturnValueOnce({ id: 'task-R1', resumeCount: 0 });                              // task lookup for resumeCount

    const emits: Array<{ type: string; message?: string }> = [];
    await resumePhasePPipeline('run-1', (e) => emits.push(e as { type: string; message?: string }));

    expect(mocks.executorResumeRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', pipelineYaml: 'adplVersion: 1\nname: r\n' }),
    );
    // tasks update 는 여러 번 호출됨 (resumed metadata + completed)
    expect(mocks.dbRun).toHaveBeenCalled();
    expect(emits.some((e) => e.type === 'task_complete')).toBe(true);
  });

  test('2. StateStore.restore throw → PHASE_P_RESUME_FAILED (taskId 없이 rawEmit 에만 로그)', async () => {
    mocks.stateStoreRestore.mockRejectedValueOnce(new Error('RUN_STATE_NOT_FOUND: run-invalid'));

    const emits: Array<{ type: string; message?: string }> = [];
    await resumePhasePPipeline('run-invalid', (e) => emits.push(e as { type: string; message?: string }));

    expect(emits.some((e) => e.message?.includes('PHASE_P_RESUME_FAILED'))).toBe(true);
    expect(emits.some((e) => e.message?.includes('RUN_STATE_NOT_FOUND'))).toBe(true);
    expect(mocks.executorResumeRun).not.toHaveBeenCalled();
  });

  test('3. executor.resumeRun throw → PHASE_P_EXECUTOR_FAILED (RESUME_FAILED 아님)', async () => {
    mocks.stateStoreRestore.mockResolvedValueOnce({
      get: () => Promise.resolve({
        id: 'run-2',
        taskId: 'task-R2',
        pipelineVersionId: 'v-R2',
        triggerContext: { triggerId: 'x', type: 'task_created', firedAt: '...' },
        worktreeRoot: '/tmp/wt',
        nodes: new Map(),
        flowStates: new Map(),
      }),
    });
    mocks.dbGet
      .mockReturnValueOnce({ id: 'task-R2', pipelineVersionId: 'v-R2', resumeCount: 0 })
      .mockReturnValueOnce({ id: 'v-R2', pipelineYaml: 'adplVersion: 1\nname: r\n' })
      .mockReturnValueOnce({ id: 'task-R2', resumeCount: 0 });
    mocks.executorResumeRun.mockRejectedValueOnce(new Error('scheduler exploded'));

    const emits: Array<{ type: string; message?: string }> = [];
    await resumePhasePPipeline('run-2', (e) => emits.push(e as { type: string; message?: string }));

    expect(emits.some((e) => e.message?.includes('PHASE_P_EXECUTOR_FAILED'))).toBe(true);
    expect(emits.every((e) => !e.message?.includes('PHASE_P_RESUME_FAILED'))).toBe(true);
    expect(emits.some((e) => e.message?.includes('scheduler exploded'))).toBe(true);
  });

  test('4. state 에 taskId 없음 → PHASE_P_RESUME_FAILED (task lookup 전 조기 reject)', async () => {
    mocks.stateStoreRestore.mockResolvedValueOnce({
      get: () => Promise.resolve({
        id: 'run-3',
        // taskId 누락
        pipelineVersionId: 'v-R3',
        nodes: new Map(),
        flowStates: new Map(),
      }),
    });

    const emits: Array<{ type: string; message?: string }> = [];
    await resumePhasePPipeline('run-3', (e) => emits.push(e as { type: string; message?: string }));

    expect(emits.some((e) => e.message?.includes('PHASE_P_RESUME_FAILED'))).toBe(true);
    expect(emits.some((e) => e.message?.includes('no taskId'))).toBe(true);
    expect(mocks.executorResumeRun).not.toHaveBeenCalled();
  });

  test('5. pipelineVersion 없음 → PHASE_P_RESUME_FAILED + failTask', async () => {
    mocks.stateStoreRestore.mockResolvedValueOnce({
      get: () => Promise.resolve({
        id: 'run-4',
        taskId: 'task-R4',
        pipelineVersionId: 'v-missing',
        triggerContext: { triggerId: 'x', type: 'task_created', firedAt: '...' },
        worktreeRoot: '/tmp/wt',
        nodes: new Map(),
        flowStates: new Map(),
      }),
    });
    mocks.dbGet
      .mockReturnValueOnce({ id: 'task-R4', pipelineVersionId: 'v-missing', resumeCount: 0 })
      .mockReturnValueOnce(null);  // pipelineVersion not found

    const emits: Array<{ type: string; message?: string }> = [];
    await resumePhasePPipeline('run-4', (e) => emits.push(e as { type: string; message?: string }));

    expect(emits.some((e) => e.message?.includes('PHASE_P_RESUME_FAILED'))).toBe(true);
    expect(emits.some((e) => e.message?.includes('pipelineVersion not found'))).toBe(true);
    expect(mocks.executorResumeRun).not.toHaveBeenCalled();
  });
});
