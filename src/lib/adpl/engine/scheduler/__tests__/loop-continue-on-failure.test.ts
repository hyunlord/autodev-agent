import { describe, it, expect, beforeEach } from 'vitest';
import { loopHandler } from '../handlers/loop-handler';
import type { FlowNodeOptions, RunSubNodeFn } from '../flow-handler';
import type { LoopNodeSpec } from '@/lib/adpl/types/nodes/loop';
import type { NodeOutput } from '@/lib/adpl/types';
import { EventBus } from '../../events/bus';
import { CancellationToken } from '../../cancel/token';

function makeOptions(bus: EventBus, token: CancellationToken): FlowNodeOptions {
  return { runId: 'run-1', eventBus: bus, token };
}

function itemsAsOver(items: unknown[]): string {
  return JSON.stringify(items);
}

describe('loopHandler — continueOnIterFailure', () => {
  let bus: EventBus;
  let token: CancellationToken;

  beforeEach(() => {
    bus = new EventBus();
    token = new CancellationToken();
  });

  // ─────────────────────────────────────────────
  // 1. continueOnIterFailure=true: 2번째 실패 → iterations 3, 2번째 failed=true, terminated='complete-with-errors'
  // ─────────────────────────────────────────────
  it('1. continueOnIterFailure=true: middle iteration fails → 3 iterations, failed record, complete-with-errors', async () => {
    const items = ['a', 'b', 'c'];
    let callCount = 0;
    const runner: RunSubNodeFn = async (_pathId): Promise<NodeOutput> => {
      callCount++;
      // 2번째 item (index=1) 의 subNode 실패
      if (callCount === 2) {
        return {
          status: 'failure',
          error: { code: 'err', message: 'item-b failed', category: 'persistent' },
        };
      }
      return { status: 'success', data: `result-${callCount}` };
    };

    const spec: LoopNodeSpec = {
      id: 'loop1',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver(items),
      continueOnIterFailure: true,
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.iterationCount).toBe(3);
    expect(data.terminated).toBe('complete-with-errors');

    const iters = data.iterations as Array<{ index: number; item: unknown; data: unknown; error?: string; failed?: boolean }>;
    expect(iters).toHaveLength(3);
    expect(iters[0].failed).toBeFalsy();
    expect(iters[0].item).toBe('a');
    expect(iters[1].failed).toBe(true);
    expect(iters[1].item).toBe('b');
    expect(iters[1].error).toBe('item-b failed');
    expect(iters[1].data).toBeUndefined();
    expect(iters[2].failed).toBeFalsy();
    expect(iters[2].item).toBe('c');
  });

  // ─────────────────────────────────────────────
  // 2. continueOnIterFailure=false (default): 실패 시 throw, terminated='error'
  // ─────────────────────────────────────────────
  it('2. continueOnIterFailure=false: failure throws and returns status=failure terminated=error', async () => {
    const runner: RunSubNodeFn = async (): Promise<NodeOutput> => ({
      status: 'failure',
      error: { code: 'err', message: 'fail fast', category: 'persistent' },
    });

    const spec: LoopNodeSpec = {
      id: 'loop2',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver(['x', 'y']),
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    expect(output.status).toBe('failure');
    const data = output.data as Record<string, unknown>;
    expect(data.terminated).toBe('error');
  });

  // ─────────────────────────────────────────────
  // 3. 모두 성공 → terminated='complete'
  // ─────────────────────────────────────────────
  it('3. all iterations succeed → terminated=complete', async () => {
    const spec: LoopNodeSpec = {
      id: 'loop3',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver([1, 2, 3]),
      continueOnIterFailure: true,
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(
      spec, 'pipeline.0',
      async () => ({ status: 'success', data: 'ok' }),
      makeOptions(bus, token),
    );

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.terminated).toBe('complete');
    expect(data.iterationCount).toBe(3);
  });

  // ─────────────────────────────────────────────
  // 4. flow.loop.iteration.failed 이벤트 emit 확인
  // ─────────────────────────────────────────────
  it('4. continueOnIterFailure=true emits flow.loop.iteration.failed event', async () => {
    const emitted: Array<{ type: string; index?: number; error?: string }> = [];
    bus.on('flow.loop.iteration.failed', (e) => {
      emitted.push({ type: e.type, index: (e as { index: number }).index, error: (e as { error: string }).error });
    });

    const runner: RunSubNodeFn = async (_pathId): Promise<NodeOutput> => ({
      status: 'failure',
      error: { code: 'err', message: 'bad', category: 'persistent' },
    });

    const spec: LoopNodeSpec = {
      id: 'loop4',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver(['only']),
      continueOnIterFailure: true,
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    await loopHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].index).toBe(0);
    expect(emitted[0].error).toBe('bad');
  });
});
