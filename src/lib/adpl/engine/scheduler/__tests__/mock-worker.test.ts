import { describe, it, expect } from 'vitest';
import { MockWorker } from '../mock-worker';
import { CancellationToken } from '../../cancel/token';
import type { ExecutionPlan } from '../../compiler/types';
import type { PipelineRunState } from '../../state/types';

const makePlan = (): ExecutionPlan =>
  ({ nodes: new Map(), topologicalOrder: [], graph: { forward: new Map(), reverse: new Map(), allNodes: [] }, context: { settings: { maxParallel: 5, totalTimeout: 7200, nodeTimeout: 600, allowedEnvKeys: [] }, variables: {} }, id: 'p1', pipelineName: 'test', compiledAt: 0 }) as ExecutionPlan;

const makeState = (): PipelineRunState =>
  ({ id: 'r1', executionPlanId: 'p1', status: 'running', nodes: new Map(), flowStates: new Map(), startedAt: new Date(), totalCostUsd: 0, totalTokensIn: 0, totalTokensOut: 0 }) as PipelineRunState;

describe('MockWorker', () => {
  it('default: returns success', async () => {
    const worker = new MockWorker();
    const token = new CancellationToken();
    const result = await worker.execute('n1', makePlan(), makeState(), token);
    expect(result.status).toBe('success');
  });

  it('defaultResult: applies to all nodes', async () => {
    const worker = new MockWorker({
      defaultResult: { status: 'failure', error: { code: 'x', message: 'y', category: 'persistent' } },
    });
    const token = new CancellationToken();
    const r1 = await worker.execute('n1', makePlan(), makeState(), token);
    const r2 = await worker.execute('n2', makePlan(), makeState(), token);
    expect(r1.status).toBe('failure');
    expect(r2.status).toBe('failure');
  });

  it('nodeResults: specific node overrides default', async () => {
    const worker = new MockWorker({
      defaultResult: { status: 'success', data: 'default' },
      nodeResults: {
        special: { status: 'success', data: 'special' },
      },
    });
    const token = new CancellationToken();
    const r1 = await worker.execute('normal', makePlan(), makeState(), token);
    const r2 = await worker.execute('special', makePlan(), makeState(), token);
    expect(r1.data).toBe('default');
    expect(r2.data).toBe('special');
  });

  it('nodeResults function: dynamic result per node', async () => {
    const worker = new MockWorker({
      nodeResults: {
        n1: (id) => ({ status: 'success', data: `executed ${id}` }),
      },
    });
    const token = new CancellationToken();
    const r = await worker.execute('n1', makePlan(), makeState(), token);
    expect(r.data).toBe('executed n1');
  });

  it('delayMs + cancel: returns cancelled status', async () => {
    const worker = new MockWorker({ delayMs: 100 });
    const token = new CancellationToken();

    setTimeout(() => token.cancel('test'), 20);
    const r = await worker.execute('n1', makePlan(), makeState(), token);

    expect(r.status).toBe('cancelled');
  });

  it('onExecute callback fires on each call', async () => {
    const calls: string[] = [];
    const worker = new MockWorker({ onExecute: (id) => calls.push(id) });
    const token = new CancellationToken();

    await worker.execute('n1', makePlan(), makeState(), token);
    await worker.execute('n2', makePlan(), makeState(), token);

    expect(calls).toEqual(['n1', 'n2']);
  });

  it('executeCount and executedNodes track calls', async () => {
    const worker = new MockWorker();
    const token = new CancellationToken();

    await worker.execute('n1', makePlan(), makeState(), token);
    await worker.execute('n2', makePlan(), makeState(), token);

    expect(worker.executeCount).toBe(2);
    expect(worker.executedNodes).toEqual(['n1', 'n2']);
  });

  it('reset clears tracking state', async () => {
    const worker = new MockWorker();
    const token = new CancellationToken();
    await worker.execute('n1', makePlan(), makeState(), token);
    worker.reset();
    expect(worker.executeCount).toBe(0);
    expect(worker.executedNodes).toEqual([]);
  });
});
