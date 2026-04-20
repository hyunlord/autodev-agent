import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { PipelineCompiler } from '../../compiler/index';
import type { ExecutionPlan } from '../../compiler/types';
import { StateStore } from '../store';
import { InvalidTransitionError } from '../types';

function yamlFromFile(name: string): string {
  return readFileSync(join(process.cwd(), `examples/adpl/${name}.yaml`), 'utf-8');
}

async function compilePlan(name: string): Promise<ExecutionPlan> {
  const compiler = new PipelineCompiler();
  const result = await compiler.compile(yamlFromFile(name));
  if (!result.ok) throw new Error(`compile failed: ${result.errors.map((e) => e.message).join(', ')}`);
  return result.plan;
}

function rootNodes(plan: ExecutionPlan) {
  return Array.from(plan.nodes.values()).filter((n) => n.prerequisites.length === 0);
}

describe('StateStore', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  it('create initializes all nodes as pending', async () => {
    const plan = await compilePlan('02-plan-code-verify');
    const state = store.create(plan);

    expect(state.status).toBe('initializing');
    expect(state.nodes.size).toBe(plan.nodes.size);
    expect(state.executionPlanId).toBe(plan.id);
    for (const node of state.nodes.values()) {
      expect(node.status).toBe('pending');
      expect(node.attemptNumber).toBe(0);
    }
  });

  it('create assigns unique runId', async () => {
    const plan = await compilePlan('01-hello-world');
    const s1 = store.create(plan);
    const s2 = store.create(plan);
    expect(s1.id).not.toBe(s2.id);
    expect(store.size()).toBe(2);
  });

  it('create sets flow states for parallel nodes', async () => {
    const plan = await compilePlan('03-parallel-checks');
    const state = store.create(plan);

    const parallelFlows = Array.from(state.flowStates.values()).filter((f) => f.type === 'parallel');
    expect(parallelFlows.length).toBeGreaterThan(0);
    const pf = parallelFlows[0];
    expect(pf.branchResults).toBeDefined();
    expect(pf.branchResults!.size).toBeGreaterThan(0);
    for (const val of pf.branchResults!.values()) {
      expect(val).toBe('pending');
    }
  });

  it('create sets flow states for loop nodes', async () => {
    const plan = await compilePlan('05-loop-foreach');
    const state = store.create(plan);

    const loopFlows = Array.from(state.flowStates.values()).filter((f) => f.type === 'loop');
    expect(loopFlows.length).toBeGreaterThan(0);
    const lf = loopFlows[0];
    expect(lf.currentIteration).toBe(0);
    expect(lf.completedIterations).toBe(0);
    expect(lf.iterationResults).toEqual([]);
  });

  it('create sets flow states for branch nodes', async () => {
    const plan = await compilePlan('04-branch-by-tags');
    const state = store.create(plan);

    const branchFlows = Array.from(state.flowStates.values()).filter((f) => f.type === 'branch');
    expect(branchFlows.length).toBeGreaterThan(0);
  });

  it('updateNode: pending → ready → running → success', async () => {
    const plan = await compilePlan('01-hello-world');
    const state = store.create(plan);
    const nodeId = rootNodes(plan)[0].pathId;

    store.updateNode(state.id, nodeId, () => ({ status: 'ready' }));
    expect(store.getNode(state.id, nodeId)!.status).toBe('ready');

    store.updateNode(state.id, nodeId, () => ({ status: 'running', startedAt: new Date(), attemptNumber: 1 }));
    expect(store.getNode(state.id, nodeId)!.status).toBe('running');
    expect(store.getNode(state.id, nodeId)!.attemptNumber).toBe(1);

    store.updateNode(state.id, nodeId, () => ({
      status: 'success',
      completedAt: new Date(),
      output: { status: 'success', data: null },
    }));
    expect(store.getNode(state.id, nodeId)!.status).toBe('success');
    expect(store.getNode(state.id, nodeId)!.output).toBeDefined();
  });

  it('updateNode: invalid transition throws InvalidTransitionError', async () => {
    const plan = await compilePlan('01-hello-world');
    const state = store.create(plan);
    const nodeId = rootNodes(plan)[0].pathId;

    expect(() =>
      store.updateNode(state.id, nodeId, () => ({ status: 'running' })),
    ).toThrow(InvalidTransitionError);
  });

  it('updateNode: failure → ready → running (retry path)', async () => {
    const plan = await compilePlan('01-hello-world');
    const state = store.create(plan);
    const nodeId = rootNodes(plan)[0].pathId;

    store.updateNode(state.id, nodeId, () => ({ status: 'ready' }));
    store.updateNode(state.id, nodeId, () => ({ status: 'running', attemptNumber: 1 }));
    store.updateNode(state.id, nodeId, () => ({
      status: 'failure',
      error: { code: 'ERR_TRANSIENT', message: 'fail', category: 'transient' },
    }));

    store.updateNode(state.id, nodeId, () => ({ status: 'ready' }));
    store.updateNode(state.id, nodeId, () => ({ status: 'running', attemptNumber: 2 }));
    expect(store.getNode(state.id, nodeId)!.attemptNumber).toBe(2);
  });

  it('updateNode: running → waiting → running (gate path)', async () => {
    const plan = await compilePlan('01-hello-world');
    const state = store.create(plan);
    const nodeId = rootNodes(plan)[0].pathId;

    store.updateNode(state.id, nodeId, () => ({ status: 'ready' }));
    store.updateNode(state.id, nodeId, () => ({ status: 'running', attemptNumber: 1 }));
    store.updateNode(state.id, nodeId, () => ({ status: 'waiting' }));
    expect(store.getNode(state.id, nodeId)!.status).toBe('waiting');

    store.updateNode(state.id, nodeId, () => ({ status: 'running' }));
    expect(store.getNode(state.id, nodeId)!.status).toBe('running');
  });

  it('listReady / listRunning reflect current state', async () => {
    const plan = await compilePlan('02-plan-code-verify');
    const state = store.create(plan);
    const nodeId = rootNodes(plan)[0].pathId;

    expect(store.listReady(state.id)).toHaveLength(0);

    store.updateNode(state.id, nodeId, () => ({ status: 'ready' }));
    expect(store.listReady(state.id)).toHaveLength(1);

    store.updateNode(state.id, nodeId, () => ({ status: 'running', attemptNumber: 1 }));
    expect(store.listRunning(state.id)).toHaveLength(1);
    expect(store.listReady(state.id)).toHaveLength(0);
  });

  it('isAllTerminal: false while nodes pending, true when all terminal', async () => {
    const plan = await compilePlan('02-plan-code-verify');
    const state = store.create(plan);

    expect(store.isAllTerminal(state.id)).toBe(false);

    for (const node of plan.nodes.values()) {
      const id = node.pathId;
      store.updateNode(state.id, id, () => ({ status: 'ready' }));
      store.updateNode(state.id, id, () => ({ status: 'running', attemptNumber: 1 }));
      store.updateNode(state.id, id, () => ({ status: 'success' }));
    }

    expect(store.isAllTerminal(state.id)).toBe(true);
  });

  it('isAllTerminal: mixed terminal statuses count as complete', async () => {
    const plan = await compilePlan('02-plan-code-verify');
    const state = store.create(plan);
    const nodeIds = Array.from(plan.nodes.keys());

    store.updateNode(state.id, nodeIds[0], () => ({ status: 'ready' }));
    store.updateNode(state.id, nodeIds[0], () => ({ status: 'running', attemptNumber: 1 }));
    store.updateNode(state.id, nodeIds[0], () => ({ status: 'success' }));

    store.updateNode(state.id, nodeIds[1], () => ({ status: 'skipped' }));
    store.updateNode(state.id, nodeIds[2], () => ({ status: 'cancelled' }));

    expect(store.isAllTerminal(state.id)).toBe(true);
  });

  it('updatePipeline: initializing → running → completed sets completedAt', async () => {
    const plan = await compilePlan('01-hello-world');
    const state = store.create(plan);

    store.updatePipeline(state.id, 'running');
    expect(store.get(state.id)!.status).toBe('running');
    expect(store.get(state.id)!.completedAt).toBeUndefined();

    store.updatePipeline(state.id, 'completed');
    expect(store.get(state.id)!.status).toBe('completed');
    expect(store.get(state.id)!.completedAt).toBeInstanceOf(Date);
  });

  it('updatePipeline: failed and cancelled also set completedAt', async () => {
    const plan = await compilePlan('01-hello-world');
    const s1 = store.create(plan);
    const s2 = store.create(plan);

    store.updatePipeline(s1.id, 'failed');
    expect(store.get(s1.id)!.completedAt).toBeDefined();

    store.updatePipeline(s2.id, 'cancelled');
    expect(store.get(s2.id)!.completedAt).toBeDefined();
  });

  it('incrementMetrics accumulates correctly', async () => {
    const plan = await compilePlan('01-hello-world');
    const state = store.create(plan);

    store.incrementMetrics(state.id, { costUsd: 0.01, tokensIn: 100 });
    store.incrementMetrics(state.id, { costUsd: 0.02, tokensOut: 50 });
    store.incrementMetrics(state.id, { tokensIn: 200, tokensOut: 150 });

    expect(state.totalCostUsd).toBeCloseTo(0.03);
    expect(state.totalTokensIn).toBe(300);
    expect(state.totalTokensOut).toBe(200);
  });

  it('updateFlow: branch takenCaseId', async () => {
    const plan = await compilePlan('04-branch-by-tags');
    const state = store.create(plan);

    const branchFlow = Array.from(state.flowStates.values()).find((f) => f.type === 'branch')!;
    expect(branchFlow).toBeDefined();

    store.updateFlow(state.id, branchFlow.flowNodeId, () => ({ takenCaseId: '0' }));
    expect(store.getFlow(state.id, branchFlow.flowNodeId)!.takenCaseId).toBe('0');
  });

  it('updateFlow: loop iteration increment', async () => {
    const plan = await compilePlan('05-loop-foreach');
    const state = store.create(plan);

    const loopFlow = Array.from(state.flowStates.values()).find((f) => f.type === 'loop')!;
    expect(loopFlow).toBeDefined();

    store.updateFlow(state.id, loopFlow.flowNodeId, (c) => ({
      currentIteration: (c.currentIteration ?? 0) + 1,
      completedIterations: (c.completedIterations ?? 0) + 1,
    }));

    const updated = store.getFlow(state.id, loopFlow.flowNodeId)!;
    expect(updated.currentIteration).toBe(1);
    expect(updated.completedIterations).toBe(1);
  });

  it('get nonexistent runId returns null', () => {
    expect(store.get('nonexistent')).toBeNull();
    expect(store.getNode('nonexistent', 'x')).toBeNull();
    expect(store.getFlow('nonexistent', 'x')).toBeNull();
  });

  it('updateNode nonexistent run throws', () => {
    expect(() =>
      store.updateNode('nonexistent', 'n1', () => ({ status: 'ready' })),
    ).toThrow(/존재하지 않습니다/);
  });

  it('updateNode nonexistent node throws', async () => {
    const plan = await compilePlan('01-hello-world');
    const state = store.create(plan);
    expect(() =>
      store.updateNode(state.id, 'no-such-node', () => ({ status: 'ready' })),
    ).toThrow(/존재하지 않습니다/);
  });

  it('delete removes run', async () => {
    const plan = await compilePlan('01-hello-world');
    const state = store.create(plan);

    expect(store.delete(state.id)).toBe(true);
    expect(store.get(state.id)).toBeNull();
    expect(store.delete('nonexistent')).toBe(false);
    expect(store.size()).toBe(0);
  });

  it('listByStatus returns correct nodes for skipped/cancelled', async () => {
    const plan = await compilePlan('02-plan-code-verify');
    const state = store.create(plan);
    const ids = Array.from(plan.nodes.keys());

    store.updateNode(state.id, ids[0], () => ({ status: 'skipped' }));
    store.updateNode(state.id, ids[1], () => ({ status: 'cancelled' }));

    expect(store.listByStatus(state.id, 'skipped')).toHaveLength(1);
    expect(store.listByStatus(state.id, 'cancelled')).toHaveLength(1);
    expect(store.listByStatus(state.id, 'pending')).toHaveLength(1);
  });
});
