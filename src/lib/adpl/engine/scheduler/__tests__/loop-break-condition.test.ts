import { describe, it, expect, beforeEach } from 'vitest';
import { loopHandler } from '../handlers/loop-handler';
import type { FlowNodeOptions } from '../flow-handler';
import type { LoopNodeSpec } from '@/lib/adpl/types/nodes/loop';
import type { NodeOutput } from '@/lib/adpl/types';
import type { Condition } from '@/lib/adpl/types/expression';
import { EventBus } from '../../events/bus';
import { CancellationToken } from '../../cancel/token';

function makeOptions(bus: EventBus, token: CancellationToken): FlowNodeOptions {
  return { runId: 'run-1', eventBus: bus, token };
}

function itemsAsOver(items: unknown[]): string {
  return JSON.stringify(items);
}

describe('loopHandler — breakCondition', () => {
  let bus: EventBus;
  let token: CancellationToken;

  beforeEach(() => {
    bus = new EventBus();
    token = new CancellationToken();
  });

  // ─────────────────────────────────────────────
  // 1. breakCondition 없음 → 모든 iteration 실행
  // ─────────────────────────────────────────────
  it('1. no breakCondition → all iterations run, terminated=complete', async () => {
    const spec: LoopNodeSpec = {
      id: 'loop1',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver(['a', 'b', 'c']),
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(
      spec, 'pipeline.0',
      async (): Promise<NodeOutput> => ({ status: 'success', data: 'ok' }),
      makeOptions(bus, token),
    );

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.iterationCount).toBe(3);
    expect(data.terminated).toBe('complete');
  });

  // ─────────────────────────────────────────────
  // 2. breakCondition: $loop.index gte 2 → index=2 끝나고 break
  // ─────────────────────────────────────────────
  it('2. breakCondition $loop.index gte 2 → breaks after index=2, iterations=3, terminated=break', async () => {
    const spec: LoopNodeSpec = {
      id: 'loop2',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver(['a', 'b', 'c', 'd', 'e']),
      breakCondition: { field: '$loop.index', gte: 2 },
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(
      spec, 'pipeline.0',
      async (): Promise<NodeOutput> => ({ status: 'success', data: 'ok' }),
      makeOptions(bus, token),
    );

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.terminated).toBe('break');
    const iters = data.iterations as Array<{ index: number }>;
    expect(iters).toHaveLength(3); // index 0, 1, 2
    expect(iters[2].index).toBe(2);
  });

  // ─────────────────────────────────────────────
  // 3. structured breakCondition: item === 'stop' → 해당 iteration 끝나고 break
  // ─────────────────────────────────────────────
  it('3. structured breakCondition: item eq stop → breaks when item matches', async () => {
    const spec: LoopNodeSpec = {
      id: 'loop3',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver(['go', 'go', 'stop', 'go']),
      breakCondition: { field: '$loop.item', eq: 'stop' },
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(
      spec, 'pipeline.0',
      async (): Promise<NodeOutput> => ({ status: 'success', data: 'done' }),
      makeOptions(bus, token),
    );

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.terminated).toBe('break');
    const iters = data.iterations as Array<{ index: number; item: unknown }>;
    expect(iters).toHaveLength(3);
    expect(iters[2].item).toBe('stop');
  });

  // ─────────────────────────────────────────────
  // 4. breakCondition 평가 throw → LOOP_BREAK_CONDITION_FAILED, status=failure
  // ─────────────────────────────────────────────
  it('4. breakCondition evaluation throws → LOOP_BREAK_CONDITION_FAILED, status=failure', async () => {
    const spec: LoopNodeSpec = {
      id: 'loop4',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver(['x']),
      // FieldCondition with no operator → evaluateFieldCondition throws
      breakCondition: { field: '$loop.index' } as unknown as Condition,
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(
      spec, 'pipeline.0',
      async (): Promise<NodeOutput> => ({ status: 'success', data: 'ok' }),
      makeOptions(bus, token),
    );

    expect(output.status).toBe('failure');
    expect(output.error?.message).toMatch(/LOOP_BREAK_CONDITION_FAILED/);
  });

  // ─────────────────────────────────────────────
  // 5. break 발동 시 flow.loop.break 이벤트 emit
  // ─────────────────────────────────────────────
  it('5. break emits flow.loop.break event with correct index', async () => {
    const emitted: Array<{ type: string; index?: number }> = [];
    bus.on('flow.loop.break', (e) => {
      emitted.push({ type: e.type, index: (e as { index: number }).index });
    });

    const spec: LoopNodeSpec = {
      id: 'loop5',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver(['only']),
      breakCondition: { field: '$loop.index', eq: 0 },
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    await loopHandler.handle(
      spec, 'pipeline.0',
      async (): Promise<NodeOutput> => ({ status: 'success', data: 'ok' }),
      makeOptions(bus, token),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].index).toBe(0);
  });
});
