import { describe, it, expect } from 'vitest';
import { computeEventsNav, parseEventsPage } from '../events-pagination';

describe('computeEventsNav — Stage 7 G2', () => {
  const base = { projectId: 'p1', runId: 'r1', pageSize: 50 };

  it('first page, full batch → hasNext, no prev', () => {
    const nav = computeEventsNav({ ...base, currentPage: 1, currentBatchLength: 50 });
    expect(nav.hasPrev).toBe(false);
    expect(nav.hasNext).toBe(true);
    expect(nav.prevHref).toBeNull();
    expect(nav.nextHref).toBe('/pipeline-runs/p1/r1?eventsPage=2');
  });

  it('first page, partial batch → no next, no prev', () => {
    const nav = computeEventsNav({ ...base, currentPage: 1, currentBatchLength: 12 });
    expect(nav.hasPrev).toBe(false);
    expect(nav.hasNext).toBe(false);
    expect(nav.prevHref).toBeNull();
    expect(nav.nextHref).toBeNull();
  });

  it('second page → prev points to base (no eventsPage=1 query)', () => {
    const nav = computeEventsNav({ ...base, currentPage: 2, currentBatchLength: 50 });
    expect(nav.hasPrev).toBe(true);
    expect(nav.prevHref).toBe('/pipeline-runs/p1/r1');
    expect(nav.nextHref).toBe('/pipeline-runs/p1/r1?eventsPage=3');
  });

  it('mid page, partial batch → prev only', () => {
    const nav = computeEventsNav({ ...base, currentPage: 4, currentBatchLength: 7 });
    expect(nav.hasPrev).toBe(true);
    expect(nav.prevHref).toBe('/pipeline-runs/p1/r1?eventsPage=3');
    expect(nav.nextHref).toBeNull();
  });
});

describe('parseEventsPage', () => {
  it('clamps to 1 for missing/invalid input', () => {
    expect(parseEventsPage(undefined)).toBe(1);
    expect(parseEventsPage('')).toBe(1);
    expect(parseEventsPage('0')).toBe(1);
    expect(parseEventsPage('-5')).toBe(1);
    expect(parseEventsPage('abc')).toBe(1);
  });

  it('returns the parsed value for valid pages', () => {
    expect(parseEventsPage('2')).toBe(2);
    expect(parseEventsPage('100')).toBe(100);
  });
});
