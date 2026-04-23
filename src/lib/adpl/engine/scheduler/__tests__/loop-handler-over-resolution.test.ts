import { describe, it, expect, beforeEach } from 'vitest';
import { loopHandler } from '../handlers/loop-handler';
import type { FlowNodeOptions, RunSubNodeFn } from '../flow-handler';
import type { LoopNodeSpec } from '@/lib/adpl/types/nodes/loop';
import type { NodeOutput } from '@/lib/adpl/types';
import { EventBus } from '../../events/bus';
import { CancellationToken } from '../../cancel/token';

/**
 * Stage 5 E1 — loop-handler.resolveOverExpression 이 `$nodes.X.Y.Z` 경로를
 * 실제 해석할 수 있어야 한다. (이전에는 undefined 반환)
 */

function baseOptions(bus: EventBus, token: CancellationToken): FlowNodeOptions {
  return { runId: 'run-over', eventBus: bus, token };
}

function withNodes(
  options: FlowNodeOptions,
  $nodes: Record<string, NodeOutput>,
): FlowNodeOptions {
  return { ...options, $nodes } as unknown as FlowNodeOptions;
}

function successRunner(data: unknown = null): RunSubNodeFn {
  return async () => ({ status: 'success', data });
}

describe('loopHandler — resolveOverExpression (Stage 5 E1)', () => {
  let bus: EventBus;
  let token: CancellationToken;

  beforeEach(() => {
    bus = new EventBus();
    token = new CancellationToken();
  });

  // 1. JSON literal (regression) — '[1,2,3]' → 3 iterations
  it('1. over as JSON literal array → 3 iterations (regression)', async () => {
    const spec: LoopNodeSpec = {
      id: 'lit',
      type: 'loop',
      mode: 'forEach',
      over: '[1,2,3]',
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(
      spec,
      'pipeline.0',
      successRunner(),
      baseOptions(bus, token),
    );

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.iterationCount).toBe(3);
  });

  // 2. `$nodes.plan.data.tasks` → resolves to array → 3 iterations
  it('2. over=$nodes.plan.data.tasks with $nodes populated → 3 iterations', async () => {
    const spec: LoopNodeSpec = {
      id: 'from-nodes',
      type: 'loop',
      mode: 'forEach',
      over: '$nodes.plan.data.tasks',
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const $nodes: Record<string, NodeOutput> = {
      plan: {
        status: 'success',
        data: { tasks: ['a', 'b', 'c'] },
      },
    };

    const output = await loopHandler.handle(
      spec,
      'pipeline.0',
      successRunner(),
      withNodes(baseOptions(bus, token), $nodes),
    );

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.iterationCount).toBe(3);
    const iters = data.iterations as Array<{ item: unknown }>;
    expect(iters[0].item).toBe('a');
    expect(iters[1].item).toBe('b');
    expect(iters[2].item).toBe('c');
  });

  // 3. `$nodes.plan.missing` → undefined → items=[] → 0 iterations
  it('3. over=$nodes.plan.missing → undefined → 0 iterations', async () => {
    const spec: LoopNodeSpec = {
      id: 'missing-path',
      type: 'loop',
      mode: 'forEach',
      over: '$nodes.plan.missing',
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const $nodes: Record<string, NodeOutput> = {
      plan: { status: 'success', data: { other: 1 } },
    };

    const output = await loopHandler.handle(
      spec,
      'pipeline.0',
      successRunner(),
      withNodes(baseOptions(bus, token), $nodes),
    );

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.iterationCount).toBe(0);
  });

  // 4. over='not_dollar_string' → JSON.parse 실패 → 문자열 반환 → Array.isArray=false → 0 iterations
  it('4. over as non-JSON non-$ string → 0 iterations (falls back to empty)', async () => {
    const spec: LoopNodeSpec = {
      id: 'bad-literal',
      type: 'loop',
      mode: 'forEach',
      over: 'not_dollar_string',
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(
      spec,
      'pipeline.0',
      successRunner(),
      baseOptions(bus, token),
    );

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.iterationCount).toBe(0);
  });
});
