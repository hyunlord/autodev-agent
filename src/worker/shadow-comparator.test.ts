import { describe, test, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  insertValues: vi.fn(),
  dbRun: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({ values: mocks.insertValues }),
  },
}));

vi.mock('@/lib/db/schema', () => ({ shadowRuns: {} }));
vi.mock('nanoid', () => ({ nanoid: () => 'sr-test-id' }));

import { recordComparison } from './shadow-comparator';
import type { LegacyResult, ShadowResult } from './shadow-comparator';

const legacyOk: LegacyResult = { ok: true, durationMs: 120 };
const shadowOk: ShadowResult = { ok: true, durationMs: 150, finalStatus: 'completed' };

describe('shadow-comparator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertValues.mockReturnValue({ run: mocks.dbRun });
    mocks.dbRun.mockResolvedValue(undefined);
  });

  test('둘 다 성공 → shadowRuns insert with correct values', async () => {
    await recordComparison('task-1', 'proj-1', legacyOk, shadowOk);

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sr-test-id',
        taskId: 'task-1',
        projectId: 'proj-1',
        legacyOk: true,
        legacyDurationMs: 120,
        legacyError: null,
        shadowOk: true,
        shadowDurationMs: 150,
        shadowError: null,
        shadowStatus: 'completed',
      }),
    );
    expect(mocks.dbRun).toHaveBeenCalled();
  });

  test('shadow 실패 → shadow_error 칼럼 저장', async () => {
    const shadowFail: ShadowResult = { ok: false, durationMs: 80, error: 'executor crashed' };
    await recordComparison('task-2', 'proj-1', legacyOk, shadowFail);

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        shadowOk: false,
        shadowError: 'executor crashed',
        shadowStatus: null,
        legacyOk: true,
      }),
    );
  });

  test('legacy 실패 + shadow 성공 → 둘 상태 모두 저장', async () => {
    const legacyFail: LegacyResult = { ok: false, durationMs: 50, error: 'legacy boom' };
    await recordComparison('task-3', 'proj-1', legacyFail, shadowOk);

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        legacyOk: false,
        legacyError: 'legacy boom',
        shadowOk: true,
        shadowStatus: 'completed',
      }),
    );
  });

  test('DB write 실패 → non-critical, 예외 미전파', async () => {
    mocks.dbRun.mockRejectedValue(new Error('DB down'));
    await expect(
      recordComparison('task-4', 'proj-1', legacyOk, shadowOk),
    ).resolves.toBeUndefined();
  });
});
