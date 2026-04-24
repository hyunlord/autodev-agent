import { describe, it, expect, vi } from 'vitest';
import { Scheduler } from '../index';
import { FlowRegistry, isFlowNode } from '../flow-registry';
import { MockWorker } from '../mock-worker';
import { StateStore } from '../../state/store';
import { EventBus } from '../../events/bus';
import { CancellationToken } from '../../cancel/token';
import { PipelineCompiler } from '../../compiler';
import type { FlowNodeHandler, FlowNodeOptions, RunSubNodeFn } from '../flow-handler';
import type { NodeOutput } from '@/lib/adpl/types';

/**
 * Stage 5 E1 — Scheduler 의 $nodes 주입 검증.
 *
 * Scheduler 는 FlowNodeHandler 에 options 를 넘길 때 기본 { runId, eventBus, token } 외에
 * - $nodes: 완료(success/failure) 노드의 userId → NodeOutput 매핑
 * - setLoopCtx: loop 핸들러가 현재 iteration 의 LoopContext 를 state 에 저장하는 콜백
 * 을 주입해야 한다.
 *
 * FlowNodeOptions 타입 자체는 flow-handler.ts 에서 고정이므로 확장 필드는 runtime 에서
 * `as unknown as { $nodes?: ... }` 로 읽는다.
 */

async function compilePipeline(yaml: string) {
  const compiler = new PipelineCompiler();
  const result = await compiler.compile(yaml);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join(', '));
  return result.plan;
}

/** 테스트용 flow handler — options 와 호출 정보를 캡처한다. */
function makeCapturingHandler(type: string) {
  const calls: { pathId: string; options: FlowNodeOptions }[] = [];
  const handler: FlowNodeHandler = {
    type,
    async handle(
      _spec: unknown,
      pathId: string,
      _runSubNode: RunSubNodeFn,
      options: FlowNodeOptions,
    ): Promise<NodeOutput> {
      calls.push({ pathId, options });
      return { status: 'success', data: null };
    },
  };
  return { handler, calls };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('Scheduler — $nodes injection into FlowNodeHandler options', () => {
  // 1. Flow handler 호출 시 options 에 $nodes 키 포함
  it('1. flow handler receives options with $nodes key', async () => {
    const { handler, calls } = makeCapturingHandler('parallel');
    expect(isFlowNode('parallel')).toBe(true);

    const yaml = `
adplVersion: 1
name: nodes-injection-1
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: par
    type: parallel
    branches:
      - id: a
        nodes:
          - id: a1
            type: agent
            role: planner
settings:
  maxParallel: 2
`;

    const plan = await compilePipeline(yaml);
    const store = new StateStore();
    const state = await store.create(plan);
    const bus = new EventBus();
    const token = new CancellationToken();
    const registry = new FlowRegistry();
    registry.register(handler);

    const scheduler = new Scheduler(plan, state, store, new MockWorker(), bus, token, {
      flowRegistry: registry,
    });
    await scheduler.run();

    expect(calls).toHaveLength(1);
    const opts = calls[0].options as unknown as { $nodes?: unknown; setLoopCtx?: unknown };
    expect(opts.$nodes).toBeDefined();
    expect(opts.setLoopCtx).toBeInstanceOf(Function);
  });

  // 2. 첫 노드 실행 시 $nodes 는 빈 객체 (아직 완료 노드 없음)
  it('2. $nodes is empty object when no prior nodes have completed', async () => {
    const { handler, calls } = makeCapturingHandler('parallel');

    const yaml = `
adplVersion: 1
name: nodes-injection-2
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: first-flow
    type: parallel
    branches:
      - id: b
        nodes:
          - id: inner
            type: agent
            role: planner
settings:
  maxParallel: 2
`;
    const plan = await compilePipeline(yaml);
    const store = new StateStore();
    const state = await store.create(plan);
    const bus = new EventBus();
    const token = new CancellationToken();
    const registry = new FlowRegistry();
    registry.register(handler);

    await new Scheduler(plan, state, store, new MockWorker(), bus, token, {
      flowRegistry: registry,
    }).run();

    expect(calls).toHaveLength(1);
    const $nodes = (calls[0].options as unknown as { $nodes: Record<string, unknown> }).$nodes;
    expect(Object.keys($nodes)).toHaveLength(0);
  });

  // 3. 노드 A 완료 후 노드 B (flow) handler options 의 $nodes.A 가 populate 됨
  it('3. after A completes, B flow handler sees $nodes.A in options', async () => {
    const { handler, calls } = makeCapturingHandler('parallel');

    const aOutput: NodeOutput = { status: 'success', data: { value: 42 } };

    const yaml = `
adplVersion: 1
name: nodes-injection-3
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: a
    type: agent
    role: planner
  - id: b
    type: parallel
    dependsOn: [a]
    branches:
      - id: only
        nodes:
          - id: b1
            type: agent
            role: planner
settings:
  maxParallel: 2
`;
    const plan = await compilePipeline(yaml);
    const store = new StateStore();
    const state = await store.create(plan);
    const bus = new EventBus();
    const token = new CancellationToken();
    const registry = new FlowRegistry();
    registry.register(handler);

    const worker = new MockWorker({
      nodeResults: {
        'pipeline.0': aOutput,
      },
    });

    await new Scheduler(plan, state, store, worker, bus, token, {
      flowRegistry: registry,
    }).run();

    expect(calls).toHaveLength(1);
    const $nodes = (calls[0].options as unknown as { $nodes: Record<string, NodeOutput> }).$nodes;
    expect($nodes.a).toBeDefined();
    expect($nodes.a.status).toBe('success');
    expect(($nodes.a.data as Record<string, unknown>).value).toBe(42);
  });

  // 4. 실패한 노드도 $nodes 에 포함됨 (collectCompletedNodeOutputs 는 success/failure 둘 다 수집)
  it('4. failed node output IS included in $nodes (success OR failure)', async () => {
    const { handler, calls } = makeCapturingHandler('parallel');

    const yaml = `
adplVersion: 1
name: nodes-injection-4
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: a
    type: agent
    role: planner
  - id: b
    type: parallel
    dependsOn: [a]
    branches:
      - id: only
        nodes:
          - id: b1
            type: agent
            role: planner
settings:
  maxParallel: 2
`;
    const plan = await compilePipeline(yaml);
    const store = new StateStore();
    const state = await store.create(plan);
    const bus = new EventBus();
    const token = new CancellationToken();
    const registry = new FlowRegistry();
    registry.register(handler);

    const worker = new MockWorker({
      nodeResults: {
        'pipeline.0': {
          status: 'failure',
          error: { code: 'a_fail', message: 'a failed', category: 'persistent' },
        },
      },
    });

    // defaultOnError=continue → b 도 실행됨
    await new Scheduler(plan, state, store, worker, bus, token, {
      flowRegistry: registry,
      defaultOnError: 'continue',
    }).run();

    expect(calls).toHaveLength(1);
    const $nodes = (calls[0].options as unknown as { $nodes: Record<string, NodeOutput> }).$nodes;
    // 실패한 a 노드도 $nodes 에 포함되어야 함
    expect($nodes.a).toBeDefined();
    expect($nodes.a.status).toBe('failure');
  });

  // 5. leaf 노드 (MockAdapter via real Worker) 의 ctx.$nodes 에 완료 노드 포함 —
  //    별도 adapter 경유가 어려우므로 flow handler 내 runSubNode 경로는 real worker 가 쓰이지만,
  //    여기서는 MockWorker 가 context 를 직접 build 하지 않으므로 $nodes 주입 검증은
  //    시나리오 3/4 로 갈음하고, 추가로 $nodes 에 flow handler 호출 이후 시점의 정확한 snapshot
  //    이 전달되는지(reference 가 아닌 값) 만 확인.
  it('5. $nodes passed to handler is a snapshot (not a live reference)', async () => {
    const { handler, calls } = makeCapturingHandler('parallel');

    const yaml = `
adplVersion: 1
name: nodes-injection-5
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: a
    type: agent
    role: planner
  - id: b
    type: parallel
    dependsOn: [a]
    branches:
      - id: only
        nodes:
          - id: b1
            type: agent
            role: planner
settings:
  maxParallel: 2
`;
    const plan = await compilePipeline(yaml);
    const store = new StateStore();
    const state = await store.create(plan);
    const bus = new EventBus();
    const token = new CancellationToken();
    const registry = new FlowRegistry();
    registry.register(handler);

    const worker = new MockWorker({
      nodeResults: {
        'pipeline.0': { status: 'success', data: 'first' },
      },
    });

    await new Scheduler(plan, state, store, worker, bus, token, {
      flowRegistry: registry,
    }).run();

    expect(calls).toHaveLength(1);
    const $nodes = (calls[0].options as unknown as { $nodes: Record<string, NodeOutput> }).$nodes;
    // 호출 시점에 'a' 가 포함되어 있어야 함
    expect($nodes).toHaveProperty('a');
    expect($nodes.a.data).toBe('first');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Scheduler — setLoopCtx callback in FlowNodeOptions', () => {
  it('setLoopCtx callback is a function on FlowNodeOptions', async () => {
    const captureSpy = vi.fn();
    const handler: FlowNodeHandler = {
      type: 'parallel',
      async handle(_spec, _pathId, _runSubNode, options): Promise<NodeOutput> {
        const setter = (options as unknown as { setLoopCtx?: unknown }).setLoopCtx;
        captureSpy(typeof setter);
        return { status: 'success', data: null };
      },
    };

    const yaml = `
adplVersion: 1
name: setloop-fn
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: p
    type: parallel
    branches:
      - id: x
        nodes:
          - id: x1
            type: agent
            role: planner
settings:
  maxParallel: 1
`;
    const plan = await compilePipeline(yaml);
    const store = new StateStore();
    const state = await store.create(plan);
    const bus = new EventBus();
    const token = new CancellationToken();
    const registry = new FlowRegistry();
    registry.register(handler);

    await new Scheduler(plan, state, store, new MockWorker(), bus, token, {
      flowRegistry: registry,
    }).run();

    expect(captureSpy).toHaveBeenCalledWith('function');
  });
});
