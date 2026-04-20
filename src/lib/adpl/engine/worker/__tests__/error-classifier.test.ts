import { describe, it, expect } from 'vitest';
import { classifyError } from '../error-classifier';
import { TimeoutError } from '../timeout';
import { CancellationError } from '../../cancel/token';

const node = {} as any;

describe('classifyError', () => {
  it('TimeoutError → code:timeout, category:timeout', () => {
    const err = new TimeoutError('node timed out', 5000);
    const result = classifyError(err, node);
    expect(result.code).toBe('timeout');
    expect(result.category).toBe('timeout');
    expect(result.message).toContain('timed out');
  });

  it('CancellationError → code:cancelled, category:cancellation', () => {
    const err = new CancellationError('user requested stop');
    const result = classifyError(err, node);
    expect(result.code).toBe('cancelled');
    expect(result.category).toBe('cancellation');
    expect(result.message).toBe('user requested stop');
  });

  it('ECONNREFUSED → code:network, category:transient', () => {
    const err = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    const result = classifyError(err, node);
    expect(result.code).toBe('network');
    expect(result.category).toBe('transient');
  });

  it('ETIMEDOUT → network (transient)', () => {
    const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    const result = classifyError(err, node);
    expect(result.code).toBe('network');
    expect(result.category).toBe('transient');
  });

  it('ECONNRESET → network (transient)', () => {
    const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    const result = classifyError(err, node);
    expect(result.category).toBe('transient');
  });

  it('AbortError → code:aborted, category:transient', () => {
    const err = new Error('fetch aborted');
    err.name = 'AbortError';
    const result = classifyError(err, node);
    expect(result.code).toBe('aborted');
    expect(result.category).toBe('transient');
  });

  it('generic Error → code:unknown, category:persistent', () => {
    const err = new Error('something went wrong');
    const result = classifyError(err, node);
    expect(result.code).toBe('unknown');
    expect(result.category).toBe('persistent');
    expect(result.message).toBe('something went wrong');
  });

  it('non-Error string → code:unknown, category:persistent', () => {
    const result = classifyError('raw string error', node);
    expect(result.code).toBe('unknown');
    expect(result.category).toBe('persistent');
    expect(result.message).toBe('raw string error');
  });

  it('non-Error object → code:unknown, category:persistent', () => {
    const result = classifyError({ reason: 'something' }, node);
    expect(result.code).toBe('unknown');
    expect(result.category).toBe('persistent');
  });
});
