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

const TRIGGER = {
  triggerId: 'tr1',
  type: 'task_created' as const,
  firedAt: '2026-04-23T00:00:00.000Z',
};

async function compilePipeline(yaml: string) {
  const compiler = new PipelineCompiler();
  const result = await compiler.compile(yaml);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join(', '));
  return result.plan;
}

// ─────────────────────────────────────────────────────────────────────────────

// 1. isFlowNode 유틸리티 확인
describe('isFlowNode', () => {
  it('parallel, branch, loop, gate → true', () => {
    expect(isFlowNode('parallel')).toBe(true);
    expect(isFlowNode('branch')).toBe(true);
    expect(isFlowNode('loop')).toBe(true);
    expect(isFlowNode('gate')).toBe(true);
  });

  it('agent, shell, http 등 leaf → false', () => {
    expect(isFlowNode('agent')).toBe(false);
    expect(isFlowNode('shell')).toBe(false);
    expect(isFlowNode('http')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Scheduler — flow node routing', () => {
  // 1. parallel 노드 → flowRegistry 통해 handler 호출 검증
  it('1. type=parallel 노드는 flowRegistry 를 통해 parallelHandler 가 호출됨', async () => {
    const handleSpy = vi.fn(
      async (
        _spec: unknown,
        _pathId: string,
        _runSubNode: RunSubNodeFn,
        _opts: FlowNodeOptions,
      ): Promise<NodeOutput> => ({
        status: 'success',
        data: { status: 'completed', branches: {} },
      }),
    );

    const fakeHandler: FlowNodeHandler = { type: 'parallel', handle: handleSpy };
    const registry = new FlowRegistry();
    registry.register(fakeHandler);

    const yaml = `
adplVersion: 1
name: routing-test
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
  maxParallel: 4
`;

    const plan = await compilePipeline(yaml);
    const store = new StateStore();
    const state = await store.create(plan);
    const bus = new EventBus();
    const token = new CancellationToken();
    const worker = new MockWorker();

    const scheduler = new Scheduler(plan, state, store, worker, bus, token, {
      flowRegistry: registry,
    });
    const result = await scheduler.run();

    expect(result.status).toBe('completed');
    expect(handleSpy).toHaveBeenCalledOnce();
    // parallel 노드의 pathId 가 전달됨
    expect(handleSpy.mock.calls[0][1]).toBe('pipeline.0');
  });

  // 2. agent 노드 → worker 경로
  it('2. type=agent 노드는 worker.execute() 경로를 통함 (flowRegistry 사용 안 함)', async () => {
    const yaml = `
adplVersion: 1
name: agent-routing
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: step1
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
    const worker = new MockWorker();

    // flowRegistry 에 agent 핸들러 없음
    const registry = new FlowRegistry();
    const scheduler = new Scheduler(plan, state, store, worker, bus, token, {
      flowRegistry: registry,
    });

    const result = await scheduler.run();

    expect(result.status).toBe('completed');
    expect(worker.executeCount).toBe(1);
    expect(worker.executedNodes).toContain('pipeline.0');
  });

  // 3. parallel 내부 agent sub-node 가 Scheduler.runSubNodeDirectly() 를 통해 worker 호출
  it('3. parallel handler 의 runSubNode 콜백이 내부 agent sub-node 를 worker 로 실행', async () => {
    const yaml = `
adplVersion: 1
name: parallel-sub-routing
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
      - id: b
        nodes:
          - id: b1
            type: agent
            role: planner
settings:
  maxParallel: 4
`;

    const plan = await compilePipeline(yaml);
    const store = new StateStore();
    const state = await store.create(plan);
    const bus = new EventBus();
    const token = new CancellationToken();
    const worker = new MockWorker();

    const scheduler = new Scheduler(plan, state, store, worker, bus, token);
    const result = await scheduler.run();

    expect(result.status).toBe('completed');
    // sub-nodes 가 worker 를 통해 실행됨
    expect(worker.executedNodes).toContain('pipeline.0.branches.0.nodes.0');
    expect(worker.executedNodes).toContain('pipeline.0.branches.1.nodes.0');
    // parallel 노드 자체는 FlowHandler 가 처리 — worker 호출 안 됨
    expect(worker.executedNodes).not.toContain('pipeline.0');
  });
});
