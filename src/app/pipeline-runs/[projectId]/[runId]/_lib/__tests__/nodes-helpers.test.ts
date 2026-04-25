import { describe, it, expect } from 'vitest';
import { extractNodeRows } from '../nodes-helpers';

describe('extractNodeRows — Stage 7 G2', () => {
  it('returns empty array for null/non-object/missing nodes field', () => {
    expect(extractNodeRows(null)).toEqual([]);
    expect(extractNodeRows(undefined)).toEqual([]);
    expect(extractNodeRows('string')).toEqual([]);
    expect(extractNodeRows({})).toEqual([]);
    expect(extractNodeRows({ nodes: null })).toEqual([]);
    expect(extractNodeRows({ nodes: 'oops' })).toEqual([]);
  });

  it('converts nodes record into row array, computing durations', () => {
    const state = {
      nodes: {
        'pipeline.0': {
          status: 'success',
          attemptNumber: 1,
          startedAt: '2026-04-25T00:00:00.000Z',
          completedAt: '2026-04-25T00:00:01.500Z',
        },
      },
    };
    const rows = extractNodeRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      nodeId: 'pipeline.0',
      status: 'success',
      attemptNumber: 1,
      durationMs: 1500,
    });
  });

  it('rows without completedAt → durationMs null', () => {
    const state = {
      nodes: {
        'pipeline.0': { status: 'running', startedAt: '2026-04-25T00:00:00.000Z' },
      },
    };
    expect(extractNodeRows(state)[0].durationMs).toBeNull();
  });

  it('extracts errorMessage from error.message', () => {
    const state = {
      nodes: {
        'p.0': {
          status: 'failure',
          error: { code: 'X', message: 'boom' },
        },
      },
    };
    expect(extractNodeRows(state)[0].errorMessage).toBe('boom');
  });

  it('errorMessage handles plain string error and absent error', () => {
    expect(extractNodeRows({ nodes: { a: { status: 's', error: 'plain' } } })[0].errorMessage).toBe('plain');
    expect(extractNodeRows({ nodes: { a: { status: 's' } } })[0].errorMessage).toBeNull();
  });

  it('sorts by startedAt asc with nulls last + tie-breaks by nodeId', () => {
    const state = {
      nodes: {
        'z': { status: 'pending' },
        'a': { status: 'success', startedAt: '2026-04-25T00:00:02.000Z' },
        'b': { status: 'success', startedAt: '2026-04-25T00:00:01.000Z' },
        'c': { status: 'pending' },
      },
    };
    const rows = extractNodeRows(state);
    expect(rows.map((r) => r.nodeId)).toEqual(['b', 'a', 'c', 'z']);
  });

  it('falls back to status="unknown" when status is missing', () => {
    const rows = extractNodeRows({ nodes: { x: {} } });
    expect(rows[0].status).toBe('unknown');
  });
});
