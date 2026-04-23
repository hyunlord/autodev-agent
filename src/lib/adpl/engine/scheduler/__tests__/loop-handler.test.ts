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

function successRunner(data: unknown = null): RunSubNodeFn {
  return async (_pathId) => ({ status: 'success', data });
}

function failRunner(msg = 'inner failure'): RunSubNodeFn {
  return async (_pathId): Promise<NodeOutput> => ({
    status: 'failure',
    error: { code: 'inner_err', message: msg, category: 'persistent' },
  });
}

// items 배열을 JSON 직렬화 형태로 over 필드에 넣는 헬퍼
// (resolveOverExpression 은 $ 미시작 시 JSON.parse 시도)
function itemsAsOver(items: unknown[]): string {
  return JSON.stringify(items);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('loopHandler', () => {
  let bus: EventBus;
  let token: CancellationToken;

  beforeEach(() => {
    bus = new EventBus();
    token = new CancellationToken();
  });

  // ─────────────────────────────────────────────
  // 1. forEach — items 3개 → iterations 길이 3, terminated='complete'
  // ─────────────────────────────────────────────
  it('1. forEach items 3개 → iterations 길이 3, terminated=complete', async () => {
    const items = ['a', 'b', 'c'];
    const spec: LoopNodeSpec = {
      id: 'loop1',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver(items),
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(spec, 'pipeline.0', successRunner('done'), makeOptions(bus, token));

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.iterationCount).toBe(3);
    expect(data.terminated).toBe('complete');
    const iters = data.iterations as Array<{ index: number; item: unknown; data: unknown }>;
    expect(iters).toHaveLength(3);
    expect(iters[0].item).toBe('a');
    expect(iters[1].item).toBe('b');
    expect(iters[2].item).toBe('c');
  });

  // ─────────────────────────────────────────────
  // 2. forEach — 빈 배열 → 0회, terminated='complete'
  // ─────────────────────────────────────────────
  it('2. forEach 빈 배열 → 0회 실행, terminated=complete', async () => {
    const spec: LoopNodeSpec = {
      id: 'loop2',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver([]),
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(spec, 'pipeline.0', successRunner(), makeOptions(bus, token));

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.iterationCount).toBe(0);
    expect(data.terminated).toBe('complete');
    expect((data.iterations as unknown[]).length).toBe(0);
  });

  // ─────────────────────────────────────────────
  // 3. forEach — spec.as='task' → 각 iteration $loop.task 주입 확인
  // ─────────────────────────────────────────────
  it('3. forEach spec.as=task → loopCtx[task] 주입 (pathId prefix 로 검증)', async () => {
    const items = [{ name: 'taskA' }, { name: 'taskB' }];
    const capturedPaths: string[] = [];

    const runner: RunSubNodeFn = async (pathId) => {
      capturedPaths.push(pathId);
      return { status: 'success', data: 'ok' };
    };

    const spec: LoopNodeSpec = {
      id: 'loop3',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver(items),
      as: 'task',
      do: [{ id: 'work', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.iterationCount).toBe(2);
    // pathId 패턴: pipeline.0.do.{index}.{nodeIdx}
    expect(capturedPaths).toContain('pipeline.0.do.0.0');
    expect(capturedPaths).toContain('pipeline.0.do.1.0');
  });

  // ─────────────────────────────────────────────
  // 4. forEach — 2번째 iteration 에서 subNode throw → terminated='error', 에러 전파
  // ─────────────────────────────────────────────
  it('4. forEach 2번째 iteration subNode 실패 → terminated=error, failure 반환', async () => {
    const items = ['x', 'y', 'z'];
    let callCount = 0;
    const runner: RunSubNodeFn = async (_pathId): Promise<NodeOutput> => {
      callCount++;
      if (callCount === 2) {
        return {
          status: 'failure',
          error: { code: 'fail', message: 'second iter failed', category: 'persistent' },
        };
      }
      return { status: 'success', data: null };
    };

    const spec: LoopNodeSpec = {
      id: 'loop4',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver(items),
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    expect(output.status).toBe('failure');
    expect(output.error?.message).toContain('second iter failed');
    const data = output.data as Record<string, unknown>;
    expect(data.terminated).toBe('error');
  });

  // ─────────────────────────────────────────────
  // 5. while — 조건: 3회 후 false → 3회 실행, terminated='complete'
  // ─────────────────────────────────────────────
  it('5. while 조건 3회 후 false → 3회 실행, terminated=complete', async () => {
    let execCount = 0;
    const runner: RunSubNodeFn = async (_pathId) => {
      execCount++;
      return { status: 'success', data: execCount };
    };

    // condition: $loop.index < 3 → index=0,1,2 → true, index=3 → false
    // 단, post-test: do 먼저 실행 후 평가. 즉 index=0,1,2 실행 후 각각 평가.
    // index 는 iteration 후 증가하므로: 실행 후 loopCtx.index 는 실행 시점 값.
    // 조건 평가는 index++ 이후 → 평가 시점 loopCtx.index 는 실행 당시 index (push 전).
    // 실제 구현에서 조건 평가는 index++ 이전 loopCtx 로 하므로:
    // iter0: do, push, index=1, 조건 평가 loopCtx.index=0 → lt: 3 → true → continue
    // iter1: do, push, index=2, 조건 평가 loopCtx.index=1 → lt: 3 → true → continue
    // iter2: do, push, index=3, 조건 평가 loopCtx.index=2 → lt: 3 → true → continue
    // iter3: do, push, index=4, 조건 평가 loopCtx.index=3 → lt: 3 → false → break
    // 즉 4회 실행됨. 올바른 post-test 언어 동작.
    // 테스트를 직관적으로 쓰기 위해: execCount < 3 을 condition 기준으로 맞춤.
    // 실행 중 $loop.index 기반 조건으로 정확히 3회 실행하려면 lt:2 (index<2이면 continue, index=2이면 stop)
    // index=0: 실행 후 index++→1, loopCtx.index=0, 0<2=true → continue
    // index=1: 실행 후 index++→2, loopCtx.index=1, 1<2=true → continue
    // index=2: 실행 후 index++→3, loopCtx.index=2, 2<2=false → break → 총 3회
    const spec: LoopNodeSpec = {
      id: 'loop5',
      type: 'loop',
      mode: 'while',
      condition: { field: '$loop.index', lt: 2 },
      maxIterations: 10,
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.iterationCount).toBe(3);
    expect(data.terminated).toBe('complete');
    expect(execCount).toBe(3);
  });

  // ─────────────────────────────────────────────
  // 6. while — 첫 체크 false 여도 1회 실행 (post-test / do-while 특성)
  // ─────────────────────────────────────────────
  it('6. while 조건 첫 평가 false 여도 1회 실행 (post-test)', async () => {
    let execCount = 0;
    const runner: RunSubNodeFn = async (_pathId) => {
      execCount++;
      return { status: 'success', data: null };
    };

    // condition: index < 0 → 항상 false → 1회 실행 후 종료
    const spec: LoopNodeSpec = {
      id: 'loop6',
      type: 'loop',
      mode: 'while',
      condition: { field: '$loop.index', lt: 0 },
      maxIterations: 10,
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    // post-test: 1회 실행 후 조건 평가 → false → 종료
    expect(data.iterationCount).toBe(1);
    expect(execCount).toBe(1);
  });

  // ─────────────────────────────────────────────
  // 7. while — maxIterations=5 + 조건 항상 true → 5회 후 LOOP_MAX_ITERATIONS_EXCEEDED throw
  // ─────────────────────────────────────────────
  it('7. while maxIterations=5 + 항상 true → LOOP_MAX_ITERATIONS_EXCEEDED throw', async () => {
    const spec: LoopNodeSpec = {
      id: 'loop7',
      type: 'loop',
      mode: 'while',
      condition: { field: '$loop.index', gte: 0 }, // 항상 true (index >= 0)
      maxIterations: 5,
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    await expect(
      loopHandler.handle(spec, 'pipeline.0', successRunner(), makeOptions(bus, token)),
    ).rejects.toThrow('LOOP_MAX_ITERATIONS_EXCEEDED');
  });

  // ─────────────────────────────────────────────
  // 8. forEach — $loop.index 0, 1, 2 순서 확인 (pathId 기반)
  // ─────────────────────────────────────────────
  it('8. forEach $loop.index 0,1,2 순서 확인 (pathId prefix 패턴)', async () => {
    const capturedPaths: string[] = [];
    const runner: RunSubNodeFn = async (pathId) => {
      capturedPaths.push(pathId);
      return { status: 'success', data: null };
    };

    const spec: LoopNodeSpec = {
      id: 'loop8',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver(['a', 'b', 'c']),
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    await loopHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    // pathId = {parentId}.do.{index}.{nodeIdx}
    expect(capturedPaths[0]).toBe('pipeline.0.do.0.0');
    expect(capturedPaths[1]).toBe('pipeline.0.do.1.0');
    expect(capturedPaths[2]).toBe('pipeline.0.do.2.0');
  });

  // ─────────────────────────────────────────────
  // 9. forEach — isFirst=true (index 0), isLast=true (마지막 index) 확인
  // ─────────────────────────────────────────────
  it('9. forEach isFirst/isLast 값이 iterations 결과에 반영됨 (item 체크로 대리)', async () => {
    const items = [10, 20, 30];
    const spec: LoopNodeSpec = {
      id: 'loop9',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver(items),
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    const output = await loopHandler.handle(spec, 'pipeline.0', successRunner(), makeOptions(bus, token));

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    const iters = data.iterations as Array<{ index: number; item: unknown }>;

    // index=0 → isFirst=true, index=2 → isLast=true (구현 내부 확인은 item/index 로 대리)
    expect(iters[0].index).toBe(0);
    expect(iters[0].item).toBe(10); // isFirst=true 인 iteration
    expect(iters[2].index).toBe(2);
    expect(iters[2].item).toBe(30); // isLast=true 인 iteration
    expect(iters).toHaveLength(3);
  });

  // ─────────────────────────────────────────────
  // 10. 이벤트 순서 — flow.loop.start / flow.loop.iteration / flow.loop.complete
  // ─────────────────────────────────────────────
  it('10. forEach 이벤트 순서: flow.loop.start → iteration×N → flow.loop.complete', async () => {
    const eventTypes: string[] = [];

    bus.on('flow.loop.start', () => { eventTypes.push('flow.loop.start'); });
    bus.on('flow.loop.iteration', () => { eventTypes.push('flow.loop.iteration'); });
    bus.on('flow.loop.complete', () => { eventTypes.push('flow.loop.complete'); });

    const spec: LoopNodeSpec = {
      id: 'loop10',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver(['x', 'y']),
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    await loopHandler.handle(spec, 'pipeline.0', successRunner(), makeOptions(bus, token));

    expect(eventTypes[0]).toBe('flow.loop.start');
    expect(eventTypes[1]).toBe('flow.loop.iteration');
    expect(eventTypes[2]).toBe('flow.loop.iteration');
    expect(eventTypes[eventTypes.length - 1]).toBe('flow.loop.complete');
    expect(eventTypes.filter((t) => t === 'flow.loop.iteration')).toHaveLength(2);
  });

  // ─────────────────────────────────────────────
  // 11. flow.loop.start kind='while' for while mode
  // ─────────────────────────────────────────────
  it('11. while 모드: flow.loop.start kind=while', async () => {
    const startEvents: Array<{ kind: string }> = [];
    bus.on('flow.loop.start', (e) => {
      startEvents.push({ kind: (e as unknown as { kind: string }).kind });
      return;
    });

    const spec: LoopNodeSpec = {
      id: 'loop11',
      type: 'loop',
      mode: 'while',
      // condition 없음 → 1회 후 종료
      maxIterations: 10,
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    await loopHandler.handle(spec, 'pipeline.0', successRunner(), makeOptions(bus, token));

    expect(startEvents).toHaveLength(1);
    expect(startEvents[0].kind).toBe('while');
  });

  // ─────────────────────────────────────────────
  // 12. flow.loop.complete iterationCount=0 for empty forEach
  // ─────────────────────────────────────────────
  it('12. forEach 빈 배열: flow.loop.complete iterationCount=0', async () => {
    const completeEvents: Array<{ iterationCount: number; terminated: string }> = [];
    bus.on('flow.loop.complete', (e) => {
      completeEvents.push({
        iterationCount: (e as unknown as { iterationCount: number }).iterationCount,
        terminated: (e as unknown as { terminated: string }).terminated,
      });
    });

    const spec: LoopNodeSpec = {
      id: 'loop12',
      type: 'loop',
      mode: 'forEach',
      over: itemsAsOver([]),
      do: [{ id: 'step', type: 'agent', role: 'planner' }],
    };

    await loopHandler.handle(spec, 'pipeline.0', successRunner(), makeOptions(bus, token));

    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0].iterationCount).toBe(0);
    expect(completeEvents[0].terminated).toBe('complete');
  });
});
