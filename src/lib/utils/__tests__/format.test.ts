import { describe, it, expect } from 'vitest';
import { formatDuration, formatRelativeTime, truncateId } from '../format';

describe('formatDuration', () => {
  it('< 1s → ms', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('1s ~ 1m → seconds', () => {
    expect(formatDuration(3500)).toBe('3.5s');
    expect(formatDuration(59999)).toBe('60.0s');
  });

  it('1m ~ 1h → minutes', () => {
    expect(formatDuration(125_000)).toBe('2.1m');
    expect(formatDuration(60_000)).toBe('1.0m');
  });

  it('>= 1h → hours', () => {
    expect(formatDuration(5_400_000)).toBe('1.5h');
  });

  it('null/undefined/negative → "-"', () => {
    expect(formatDuration(null)).toBe('-');
    expect(formatDuration(undefined)).toBe('-');
    expect(formatDuration(-1)).toBe('-');
    expect(formatDuration(NaN)).toBe('-');
  });
});

describe('formatRelativeTime', () => {
  const NOW = new Date('2026-04-25T12:00:00.000Z').getTime();

  it('30s ago', () => {
    const iso = new Date(NOW - 30_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe('30초 전');
  });

  it('5m ago', () => {
    const iso = new Date(NOW - 5 * 60_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe('5분 전');
  });

  it('2h ago', () => {
    const iso = new Date(NOW - 2 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe('2시간 전');
  });

  it('older than 1d → date string (locale ko-KR)', () => {
    const iso = '2026-04-20T00:00:00.000Z';
    const out = formatRelativeTime(iso, NOW);
    expect(out).not.toMatch(/전/);
    expect(out.length).toBeGreaterThan(0);
  });

  it('null → "-"', () => {
    expect(formatRelativeTime(null, NOW)).toBe('-');
    expect(formatRelativeTime(undefined, NOW)).toBe('-');
    expect(formatRelativeTime('not-a-date', NOW)).toBe('-');
  });

  it('future timestamp → "-" (defensive)', () => {
    const future = new Date(NOW + 60_000).toISOString();
    expect(formatRelativeTime(future, NOW)).toBe('-');
  });
});

describe('truncateId', () => {
  it('truncates to default length 8', () => {
    expect(truncateId('abcd1234efgh')).toBe('abcd1234');
  });

  it('respects custom length', () => {
    expect(truncateId('abcd1234efgh', 4)).toBe('abcd');
  });

  it('returns original when shorter than length', () => {
    expect(truncateId('abc', 8)).toBe('abc');
  });

  it('null/undefined → "-"', () => {
    expect(truncateId(null)).toBe('-');
    expect(truncateId(undefined)).toBe('-');
    expect(truncateId('')).toBe('-');
  });
});
