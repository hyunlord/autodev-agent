import { describe, it, expect } from 'vitest';
import { formatSseEvent, formatHeartbeat, computeNextSince } from '../sse-format';

describe('formatSseEvent — Stage 7 G3', () => {
  it('emits data-only frame when type/id omitted', () => {
    const out = formatSseEvent({ data: { foo: 1 } });
    expect(out).toBe('data: {"foo":1}\n\n');
  });

  it('includes typed event line', () => {
    const out = formatSseEvent({ type: 'pipeline', data: { a: 'b' } });
    expect(out).toBe('event: pipeline\ndata: {"a":"b"}\n\n');
  });

  it('includes id when supplied (for resume support)', () => {
    const out = formatSseEvent({ type: 'pipeline', id: 'evt-1', data: { x: 1 } });
    expect(out).toBe('event: pipeline\nid: evt-1\ndata: {"x":1}\n\n');
  });

  it('null data serializes to literal null', () => {
    const out = formatSseEvent({ data: null });
    expect(out).toBe('data: null\n\n');
  });

  it('terminates with double newline', () => {
    expect(formatSseEvent({ data: 1 }).endsWith('\n\n')).toBe(true);
  });
});

describe('formatHeartbeat', () => {
  it('emits a comment frame', () => {
    expect(formatHeartbeat()).toBe(': heartbeat\n\n');
  });
});

describe('computeNextSince — Stage 7 G3', () => {
  it('empty batch keeps the previous cursor', () => {
    expect(computeNextSince(undefined, [])).toBeUndefined();
    expect(computeNextSince('2026-04-25T00:00:00.000Z', [])).toBe('2026-04-25T00:00:00.000Z');
  });

  it('returns the last createdAt in the batch (asc-ordered)', () => {
    const batch = [
      { createdAt: '2026-04-25T00:00:00.000Z' },
      { createdAt: '2026-04-25T00:00:01.500Z' },
      { createdAt: '2026-04-25T00:00:02.999Z' },
    ];
    expect(computeNextSince(undefined, batch)).toBe('2026-04-25T00:00:02.999Z');
  });

  it('overrides previous cursor when batch has rows', () => {
    expect(
      computeNextSince('1970-01-01T00:00:00.000Z', [{ createdAt: '2026-04-25T00:00:00.000Z' }]),
    ).toBe('2026-04-25T00:00:00.000Z');
  });
});
