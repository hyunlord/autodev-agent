import { describe, it, expect } from 'vitest';
import { MockAdapter } from '../mock';
import type { ExecutionContext, ExecutionOptions } from '../types';
import { CancellationToken } from '../../cancel/token';
import { EventBus } from '../../events/bus';

function makeOptions(): ExecutionOptions {
  return {
    cancellationToken: new CancellationToken(),
    eventBus: new EventBus(),
    timeoutMs: 5000,
  };
}

function makeContext(): ExecutionContext {
  return {
    $task: null as never,
    $project: null as never,
    $trigger: null as never,
    $env: {},
    $now: new Date(),
    $self: null as never,
    $nodes: {},
    $prev: null,
    $loop: null,
    $flow: null,
    $variables: {},
    worktreeRoot: '/tmp/test-worktree',
  };
}

const SPEC = { id: 'n1', type: 'agent' } as never;

describe('MockAdapter', () => {
  it('default behavior: status=success, data=undefined', async () => {
    const mock = new MockAdapter({ type: 'agent' });
    const result = await mock.execute(SPEC, makeContext(), makeOptions());

    expect(result.status).toBe('success');
    expect(result.data).toBeUndefined();
  });

  it('configured success with data', async () => {
    const mock = new MockAdapter({
      type: 'agent',
      behavior: { result: { kind: 'success', data: { answer: 42 } } },
    });

    const result = await mock.execute(SPEC, makeContext(), makeOptions());
    expect(result.status).toBe('success');
    expect(result.data).toEqual({ answer: 42 });
  });

  it('configured failure returns failure output with error fields', async () => {
    const mock = new MockAdapter({
      type: 'shell',
      behavior: {
        result: {
          kind: 'failure',
          error: { code: 'exit_1', message: '명령 실패', category: 'persistent' },
        },
      },
    });

    const result = await mock.execute(SPEC, makeContext(), makeOptions());
    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('exit_1');
    expect(result.error?.message).toBe('명령 실패');
    expect(result.error?.category).toBe('persistent');
  });

  it('failure without category defaults to persistent', async () => {
    const mock = new MockAdapter({
      type: 'shell',
      behavior: {
        result: { kind: 'failure', error: { code: 'err', message: 'fail' } },
      },
    });

    const result = await mock.execute(SPEC, makeContext(), makeOptions());
    expect(result.error?.category).toBe('persistent');
  });

  it('delayMs waits before returning', async () => {
    const mock = new MockAdapter({ type: 'agent', behavior: { delayMs: 50 } });

    const start = Date.now();
    await mock.execute(SPEC, makeContext(), makeOptions());
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('onExecute callback fires with spec and context', async () => {
    const calls: Array<{ spec: unknown; ctx: unknown }> = [];
    const mock = new MockAdapter({
      type: 'agent',
      behavior: {
        onExecute: (spec, ctx) => calls.push({ spec, ctx }),
      },
    });

    const ctx = makeContext();
    await mock.execute(SPEC, ctx, makeOptions());

    expect(calls).toHaveLength(1);
    expect(calls[0].spec).toBe(SPEC);
    expect(calls[0].ctx).toBe(ctx);
  });

  it('executeCallback overrides delay and result', async () => {
    const mock = new MockAdapter({
      type: 'agent',
      behavior: {
        delayMs: 10000,
        result: { kind: 'failure', error: { code: 'x', message: 'y' } },
        executeCallback: async () => ({ status: 'success', data: { custom: true } }),
      },
    });

    const start = Date.now();
    const result = await mock.execute(SPEC, makeContext(), makeOptions());
    expect(Date.now() - start).toBeLessThan(100);
    expect(result.status).toBe('success');
    expect(result.data).toEqual({ custom: true });
  });

  it('tracks executeCount', async () => {
    const mock = new MockAdapter({ type: 'agent' });
    expect(mock.executeCount).toBe(0);

    await mock.execute(SPEC, makeContext(), makeOptions());
    await mock.execute(SPEC, makeContext(), makeOptions());
    expect(mock.executeCount).toBe(2);
  });

  it('lastSpec and lastContext reflect most recent call', async () => {
    const mock = new MockAdapter({ type: 'agent' });
    const ctx = makeContext();

    await mock.execute(SPEC, ctx, makeOptions());
    expect(mock.lastSpec).toBe(SPEC);
    expect(mock.lastContext).toBe(ctx);
  });

  it('reset clears executeCount, lastSpec, lastContext', async () => {
    const mock = new MockAdapter({ type: 'agent' });
    await mock.execute(SPEC, makeContext(), makeOptions());

    mock.reset();
    expect(mock.executeCount).toBe(0);
    expect(mock.lastSpec).toBeNull();
    expect(mock.lastContext).toBeNull();
  });

  it('setBehavior changes runtime behavior', async () => {
    const mock = new MockAdapter({ type: 'agent' });

    const r1 = await mock.execute(SPEC, makeContext(), makeOptions());
    expect(r1.status).toBe('success');

    mock.setBehavior({
      result: { kind: 'failure', error: { code: 'x', message: 'changed' } },
    });

    const r2 = await mock.execute(SPEC, makeContext(), makeOptions());
    expect(r2.status).toBe('failure');
    expect(r2.error?.message).toBe('changed');
  });

  it('validate always returns valid: true', () => {
    const mock = new MockAdapter({ type: 'agent' });
    expect(mock.validate(SPEC).valid).toBe(true);
  });

  it('defaultTimeout returns 30', () => {
    expect(new MockAdapter({ type: 'agent' }).defaultTimeout()).toBe(30);
  });

  it('type is set from constructor', () => {
    expect(new MockAdapter({ type: 'shell' }).type).toBe('shell');
    expect(new MockAdapter({ type: 'mock-xyz' }).type).toBe('mock-xyz');
  });
});
