import { describe, it, expect } from 'vitest';
import { clampPageRedirectTarget } from '../clamp-page';

describe('clampPageRedirectTarget — Stage 7 G1 micro-fix', () => {
  const baseArgs = { projectId: 'p1', status: undefined, taskId: undefined };

  it('returns null when requested page is within range', () => {
    expect(
      clampPageRedirectTarget({ ...baseArgs, requestedPage: 2, totalPages: 5, total: 100 }),
    ).toBeNull();
    expect(
      clampPageRedirectTarget({ ...baseArgs, requestedPage: 5, totalPages: 5, total: 100 }),
    ).toBeNull();
    expect(
      clampPageRedirectTarget({ ...baseArgs, requestedPage: 1, totalPages: 1, total: 5 }),
    ).toBeNull();
  });

  it('returns null when there are no rows (empty state should render)', () => {
    expect(
      clampPageRedirectTarget({ ...baseArgs, requestedPage: 999, totalPages: 1, total: 0 }),
    ).toBeNull();
  });

  it('redirects to last valid page when requestedPage exceeds totalPages', () => {
    const target = clampPageRedirectTarget({
      ...baseArgs,
      requestedPage: 999,
      totalPages: 5,
      total: 100,
    });
    expect(target).toBe('/pipeline-runs/p1?page=5');
  });

  it('omits page=1 from URL (uses default route)', () => {
    const target = clampPageRedirectTarget({
      ...baseArgs,
      requestedPage: 999,
      totalPages: 1,
      total: 5,
    });
    expect(target).toBe('/pipeline-runs/p1');
  });

  it('preserves status filter on redirect', () => {
    const target = clampPageRedirectTarget({
      ...baseArgs,
      requestedPage: 50,
      totalPages: 3,
      total: 50,
      status: 'failed',
    });
    expect(target).toBe('/pipeline-runs/p1?status=failed&page=3');
  });

  it('preserves taskId filter on redirect', () => {
    const target = clampPageRedirectTarget({
      ...baseArgs,
      requestedPage: 99,
      totalPages: 2,
      total: 30,
      taskId: 'abc',
    });
    expect(target).toBe('/pipeline-runs/p1?taskId=abc&page=2');
  });

  it('preserves both filters together', () => {
    const target = clampPageRedirectTarget({
      ...baseArgs,
      requestedPage: 10,
      totalPages: 4,
      total: 70,
      status: 'completed',
      taskId: 'xyz',
    });
    expect(target).toBe('/pipeline-runs/p1?status=completed&taskId=xyz&page=4');
  });
});
