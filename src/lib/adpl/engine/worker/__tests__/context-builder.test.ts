import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { PipelineCompiler } from '../../compiler';
import { StateStore } from '../../state/store';
import { buildExecutionContext } from '../context-builder';

const TEST_WORKTREE = '/tmp/test-worktree';

async function setupPlan(sampleFile: string) {
  const compiler = new PipelineCompiler();
  const yaml = readFileSync(`examples/adpl/${sampleFile}`, 'utf-8');
  const result = await compiler.compile(yaml);
  if (!result.ok) throw new Error(`Compile failed: ${result.errors.map((e) => e.message).join(', ')}`);
  const plan = result.plan;
  const store = new StateStore();
  const state = store.create(plan);
  return { plan, state, store };
}

function transitionToSuccess(store: StateStore, runId: string, nodeId: string, data: unknown = null) {
  store.updateNode(runId, nodeId, () => ({ status: 'ready' }));
  store.updateNode(runId, nodeId, () => ({ status: 'running', startedAt: new Date() }));
  store.updateNode(runId, nodeId, () => ({
    status: 'success',
    completedAt: new Date(),
    output: { status: 'success', data },
  }));
}

describe('buildExecutionContext', () => {
  it('$now is a Date', async () => {
    const { plan, state } = await setupPlan('01-hello-world.yaml');
    const node = plan.nodes.values().next().value!;
    const ctx = buildExecutionContext(node, plan, state, {}, TEST_WORKTREE);
    expect(ctx.$now).toBeInstanceOf(Date);
  });

  it('$self is the compiled node', async () => {
    const { plan, state } = await setupPlan('01-hello-world.yaml');
    const node = plan.nodes.values().next().value!;
    const ctx = buildExecutionContext(node, plan, state, {}, TEST_WORKTREE);
    expect(ctx.$self).toBe(node);
  });

  it('$variables from plan.context.variables', async () => {
    const { plan, state } = await setupPlan('01-hello-world.yaml');
    const node = plan.nodes.values().next().value!;
    const ctx = buildExecutionContext(node, plan, state, {}, TEST_WORKTREE);
    expect(ctx.$variables).toBe(plan.context.variables);
  });

  it('$env reflects passed env object', async () => {
    const { plan, state } = await setupPlan('01-hello-world.yaml');
    const node = plan.nodes.values().next().value!;
    const ctx = buildExecutionContext(node, plan, state, { FOO: 'bar', X: '1' }, TEST_WORKTREE);
    expect(ctx.$env).toEqual({ FOO: 'bar', X: '1' });
  });

  it('$env defaults to empty object', async () => {
    const { plan, state } = await setupPlan('01-hello-world.yaml');
    const node = plan.nodes.values().next().value!;
    const ctx = buildExecutionContext(node, plan, state, {}, TEST_WORKTREE);
    expect(ctx.$env).toEqual({});
  });

  it('$loop and $flow are null (v1)', async () => {
    const { plan, state } = await setupPlan('01-hello-world.yaml');
    const node = plan.nodes.values().next().value!;
    const ctx = buildExecutionContext(node, plan, state, {}, TEST_WORKTREE);
    expect(ctx.$loop).toBeNull();
    expect(ctx.$flow).toBeNull();
  });

  it('$nodes: empty when no completed nodes', async () => {
    const { plan, state } = await setupPlan('01-hello-world.yaml');
    const node = plan.nodes.values().next().value!;
    const ctx = buildExecutionContext(node, plan, state, {}, TEST_WORKTREE);
    expect(Object.keys(ctx.$nodes)).toHaveLength(0);
  });

  it('$nodes: keyed by userId, only success/failure nodes', async () => {
    const { plan, state, store } = await setupPlan('02-plan-code-verify.yaml');
    const [planNode, codeNode, verifyNode] = plan.topologicalOrder.map((id) => plan.nodes.get(id)!);

    transitionToSuccess(store, state.id, planNode.pathId, 'plan-result');

    // For verify node, $nodes should include plan but not code (still pending)
    const ctx = buildExecutionContext(verifyNode, plan, state, {}, TEST_WORKTREE);
    expect(ctx.$nodes[planNode.userId]).toBeDefined();
    expect(ctx.$nodes[planNode.userId].data).toBe('plan-result');
    expect(ctx.$nodes[codeNode.userId]).toBeUndefined();
    expect(ctx.$nodes[verifyNode.userId]).toBeUndefined();
  });

  it('$nodes: includes failure nodes too', async () => {
    const { plan, state, store } = await setupPlan('02-plan-code-verify.yaml');
    const [planNode] = plan.topologicalOrder.map((id) => plan.nodes.get(id)!);

    store.updateNode(state.id, planNode.pathId, () => ({ status: 'ready' }));
    store.updateNode(state.id, planNode.pathId, () => ({ status: 'running', startedAt: new Date() }));
    store.updateNode(state.id, planNode.pathId, () => ({
      status: 'failure',
      completedAt: new Date(),
      output: { status: 'failure', error: { code: 'test', message: 'fail', category: 'persistent' } },
    }));

    const [, codeNode] = plan.topologicalOrder.map((id) => plan.nodes.get(id)!);
    const ctx = buildExecutionContext(codeNode, plan, state, {}, TEST_WORKTREE);
    expect(ctx.$nodes[planNode.userId]).toBeDefined();
  });

  it('$prev: null for first node (no prerequisites)', async () => {
    const { plan, state } = await setupPlan('01-hello-world.yaml');
    const node = plan.nodes.values().next().value!;
    const ctx = buildExecutionContext(node, plan, state, {}, TEST_WORKTREE);
    expect(ctx.$prev).toBeNull();
  });

  it('$prev: output of direct predecessor', async () => {
    const { plan, state, store } = await setupPlan('02-plan-code-verify.yaml');
    const [planNode, codeNode] = plan.topologicalOrder.map((id) => plan.nodes.get(id)!);

    transitionToSuccess(store, state.id, planNode.pathId, 'plan-output');

    const ctx = buildExecutionContext(codeNode, plan, state, {}, TEST_WORKTREE);
    expect(ctx.$prev).toBeDefined();
    expect(ctx.$prev!.data).toBe('plan-output');
  });

  it('$prev: null if predecessor has no output yet', async () => {
    const { plan, state } = await setupPlan('02-plan-code-verify.yaml');
    const [, codeNode] = plan.topologicalOrder.map((id) => plan.nodes.get(id)!);
    // plan node still pending — no output
    const ctx = buildExecutionContext(codeNode, plan, state, {}, TEST_WORKTREE);
    expect(ctx.$prev).toBeNull();
  });

  it('throws ExecutionContextError when no worktreeRoot can be resolved', async () => {
    const { plan, state } = await setupPlan('01-hello-world.yaml');
    const node = plan.nodes.values().next().value!;
    expect(() => buildExecutionContext(node, plan, state)).toThrow('Cannot determine worktreeRoot');
  });

  it('worktreeRoot is set from hint', async () => {
    const { plan, state } = await setupPlan('01-hello-world.yaml');
    const node = plan.nodes.values().next().value!;
    const ctx = buildExecutionContext(node, plan, state, {}, '/some/path');
    expect(ctx.worktreeRoot).toBe('/some/path');
  });
});
