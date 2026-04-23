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

describe('shadow mode 검증 시나리오', () => {
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

  // ── 기본 동작 ──────────────────────────────────────────────────────────────

  test('1. legacy 성공 + shadow 성공 → comparator에 양쪽 ok=true 기록', async () => {
    await runShadow(baseTask, rawEmit, emit);

    expect(mocks.recordComparison).toHaveBeenCalledOnce();
    expect(mocks.recordComparison).toHaveBeenCalledWith(
      'task-1', 'proj-1',
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true, finalStatus: 'completed' }),
    );
    // runShadow 자체는 항상 resolve
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('legacy=ok shadow=ok') }),
    );
  });

  test('2. legacy 성공 + shadow 실패 → legacy 성공 반환, shadow_error 기록', async () => {
    mocks.executorRun.mockRejectedValue(new Error('shadow executor failed'));

    await runShadow(baseTask, rawEmit, emit);

    // legacy still called
    expect(mocks.runLegacyPipeline).toHaveBeenCalledOnce();
    // comparator records shadow failure
    expect(mocks.recordComparison).toHaveBeenCalledWith(
      'task-1', 'proj-1',
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: false, error: 'shadow executor failed' }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('legacy=ok shadow=fail') }),
    );
  });

  test('3. legacy 실패 + shadow 성공 → legacy 실패 전원, shadow_ok=true 기록', async () => {
    mocks.runLegacyPipeline.mockRejectedValue(new Error('legacy pipeline error'));

    await runShadow(baseTask, rawEmit, emit);

    expect(mocks.recordComparison).toHaveBeenCalledWith(
      'task-1', 'proj-1',
      expect.objectContaining({ ok: false, error: 'legacy pipeline error' }),
      expect.objectContaining({ ok: true }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('legacy=fail shadow=ok') }),
    );
  });

  // ── 타이밍 ─────────────────────────────────────────────────────────────────

  test('4. shadow 가 30초 내 완료 → 정상 완료로 기록', async () => {
    vi.useFakeTimers();
    mocks.executorRun.mockResolvedValue({ status: 'completed' });

    const p = runShadow(baseTask, rawEmit, emit);
    // 5초만 진행 (30초 미만) — shadow 이미 resolved
    await vi.advanceTimersByTimeAsync(5_000);
    await p;

    expect(mocks.recordComparison).toHaveBeenCalledWith(
      'task-1', 'proj-1',
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true, finalStatus: 'completed' }),
    );
  });

  test('5. shadow 가 60초 후에도 안 끝남 → 30초 grace 후 abort, shadow.ok=false', async () => {
    vi.useFakeTimers();
    mocks.executorRun.mockReturnValue(new Promise<never>(() => {})); // never resolves

    const p = runShadow(baseTask, rawEmit, emit);
    await vi.runAllTimersAsync(); // fires 30s timeout → abort
    await p;

    expect(mocks.recordComparison).toHaveBeenCalledWith(
      'task-1', 'proj-1',
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: false, error: expect.stringContaining('aborted') }),
    );
  });

  test('6. shadow 가 legacy 보다 먼저 끝남 → legacy await 계속, 두 결과 모두 기록', async () => {
    let resolveLegacy!: () => void;
    mocks.runLegacyPipeline.mockReturnValue(
      new Promise<void>((res) => { resolveLegacy = res; }),
    );
    // shadow resolves immediately
    mocks.executorRun.mockResolvedValue({ status: 'completed' });

    const runPromise = runShadow(baseTask, rawEmit, emit);

    // not done yet — legacy is still pending
    expect(mocks.recordComparison).not.toHaveBeenCalled();

    resolveLegacy();
    await runPromise;

    expect(mocks.recordComparison).toHaveBeenCalledWith(
      'task-1', 'proj-1',
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true, finalStatus: 'completed' }),
    );
  });

  // ── pipelineVersion ────────────────────────────────────────────────────────

  test('7. shadow 시에도 pipelineVersionId null → ensureDefault 호출', async () => {
    const taskNoVersion = { ...baseTask, pipelineVersionId: null };
    mocks.ensureDefaultPipelineVersion.mockResolvedValue('auto-v');
    mocks.dbGet.mockReturnValue({ id: 'auto-v', pipelineYaml: 'adplVersion: 1\n' });

    await runShadow(taskNoVersion, rawEmit, emit);

    expect(mocks.ensureDefaultPipelineVersion).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-1' }),
    );
    expect(mocks.executorRun).toHaveBeenCalled();
  });

  // ── 독립성 ─────────────────────────────────────────────────────────────────

  test('8. shadow reject → process unhandledRejection 없음', async () => {
    const unhandled: unknown[] = [];
    const h = (r: unknown) => unhandled.push(r);
    process.on('unhandledRejection', h);

    mocks.executorRun.mockRejectedValue(new Error('blown up'));
    await runShadow(baseTask, rawEmit, emit);

    // flush remaining microtasks / macrotasks
    await new Promise<void>((r) => setImmediate(r));

    process.off('unhandledRejection', h);
    expect(unhandled).toHaveLength(0);
  });

  test('9. shadow 실패해도 legacy DB 쓰기 영향 없음 — runLegacyPipeline 정확히 1회 호출', async () => {
    mocks.executorRun.mockRejectedValue(new Error('shadow crash'));

    await runShadow(baseTask, rawEmit, emit);

    // legacy called exactly once with the right args, unaffected by shadow
    expect(mocks.runLegacyPipeline).toHaveBeenCalledOnce();
    expect(mocks.runLegacyPipeline).toHaveBeenCalledWith('task-1', rawEmit, undefined);
    // comparator records legacy ok even though shadow failed
    expect(mocks.recordComparison).toHaveBeenCalledWith(
      'task-1', 'proj-1',
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: false }),
    );
  });

  // ── 연속 실행 ──────────────────────────────────────────────────────────────

  test('10. 연속 3개 shadow task → shadow_runs 3개 별도 행으로 recordComparison 호출', async () => {
    const tasks = [
      { ...baseTask, id: 'task-a', projectId: 'proj-a' },
      { ...baseTask, id: 'task-b', projectId: 'proj-b' },
      { ...baseTask, id: 'task-c', projectId: 'proj-c' },
    ] as Parameters<typeof runShadow>[0][];

    for (const t of tasks) {
      await runShadow(t, rawEmit, emit);
    }

    expect(mocks.recordComparison).toHaveBeenCalledTimes(3);
    expect(mocks.recordComparison).toHaveBeenNthCalledWith(
      1, 'task-a', 'proj-a', expect.objectContaining({ ok: true }), expect.anything(),
    );
    expect(mocks.recordComparison).toHaveBeenNthCalledWith(
      2, 'task-b', 'proj-b', expect.objectContaining({ ok: true }), expect.anything(),
    );
    expect(mocks.recordComparison).toHaveBeenNthCalledWith(
      3, 'task-c', 'proj-c', expect.objectContaining({ ok: true }), expect.anything(),
    );
  });
});
