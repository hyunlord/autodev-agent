import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parallelHandler } from '../handlers/parallel-handler';
import type { FlowNodeOptions, RunSubNodeFn } from '../flow-handler';
import type { ParallelNodeSpec } from '@/lib/adpl/types/nodes/parallel';
import type { NodeOutput } from '@/lib/adpl/types';
import { EventBus } from '../../events/bus';
import { CancellationToken } from '../../cancel/token';

function makeOptions(bus: EventBus, token: CancellationToken): FlowNodeOptions {
  return { runId: 'run-1', eventBus: bus, token };
}

function makeSpec(overrides: Partial<ParallelNodeSpec> = {}): ParallelNodeSpec {
  return {
    id: 'proc',
    type: 'parallel',
    branches: [
      { id: 'a', nodes: [{ id: 'a1', type: 'agent', role: 'planner' }] },
      { id: 'b', nodes: [{ id: 'b1', type: 'agent', role: 'planner' }] },
      { id: 'c', nodes: [{ id: 'c1', type: 'agent', role: 'planner' }] },
    ],
    ...overrides,
  };
}

function successRunner(data: unknown = null): RunSubNodeFn {
  return async (_pathId) => ({ status: 'success', data });
}

function failingRunner(failPathId: string): RunSubNodeFn {
  return async (pathId) => {
    if (pathId === failPathId) {
      return {
        status: 'failure',
        error: { code: 'test_err', message: `${pathId} failed`, category: 'persistent' },
      };
    }
    return { status: 'success', data: null };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('parallelHandler', () => {
  let bus: EventBus;
  let token: CancellationToken;

  beforeEach(() => {
    bus = new EventBus();
    token = new CancellationToken();
  });

  // 1. 3 branches 동시 성공
  it('1. 3 branches 동시 성공 → branches 객체에 3개 모두 ok', async () => {
    const spec = makeSpec();
    const output = await parallelHandler.handle(spec, 'pipeline.0', successRunner('result'), makeOptions(bus, token));

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.status).toBe('completed');
    const branches = data.branches as Record<string, unknown>;
    expect(Object.keys(branches)).toHaveLength(3);
    expect((branches['a'] as Record<string, unknown>).ok).toBe(true);
    expect((branches['b'] as Record<string, unknown>).ok).toBe(true);
    expect((branches['c'] as Record<string, unknown>).ok).toBe(true);
  });

  // 2. fail-fast — 1개 실패 시 전체 throw
  it('2. fail-fast (onError default): 1 branch 실패 → output status failure', async () => {
    const spec = makeSpec(); // onError 미설정 = abort_all (fail-fast)
    // branch b's node 'pipeline.0.branches.1.nodes.0' fails
    const runner = failingRunner('pipeline.0.branches.1.nodes.0');

    const output = await parallelHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    expect(output.status).toBe('failure');
    expect(output.error?.code).toBe('branch_failure');
  });

  // 3. continueOnBranchFailure — 1 branch 실패해도 나머지 계속
  it('3. onError=continue: 1 branch 실패해도 나머지 완료 + branchFailures 포함', async () => {
    const spec = makeSpec({ onError: 'continue' });
    const runner = failingRunner('pipeline.0.branches.1.nodes.0');

    const output = await parallelHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    expect(output.status).toBe('failure'); // partial failure
    const data = output.data as Record<string, unknown>;
    expect(data.status).toBe('partial');
    const branchFailures = data.branchFailures as Array<{ branchId: string }>;
    expect(branchFailures).toHaveLength(1);
    expect(branchFailures[0].branchId).toBe('b');
    // a, c 는 성공
    const branches = data.branches as Record<string, { ok: boolean }>;
    expect(branches['a'].ok).toBe(true);
    expect(branches['c'].ok).toBe(true);
  });

  // 4. maxConcurrent=1 → 순차 실행 검증
  it('4. maxConcurrent=1 → 한 번에 하나씩 실행 (실행 순서 보장)', async () => {
    const order: string[] = [];
    const runner: RunSubNodeFn = async (pathId) => {
      order.push(pathId);
      return { status: 'success', data: null };
    };
    const spec = makeSpec({ maxConcurrent: 1 });

    await parallelHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    // 각 branch 의 노드가 1개씩이므로 순서는 branch 순서대로
    expect(order).toHaveLength(3);
    // maxConcurrent=1 이므로 첫 번째 branch 가 완전히 끝난 후 두 번째 시작
    expect(order[0]).toBe('pipeline.0.branches.0.nodes.0');
    expect(order[1]).toBe('pipeline.0.branches.1.nodes.0');
    expect(order[2]).toBe('pipeline.0.branches.2.nodes.0');
  });

  // 5. maxConcurrency=2, 5 branches
  it('5. maxConcurrent=2, 5 branches → 최대 2개씩 동시 실행', async () => {
    let concurrent = 0;
    let maxSeen = 0;
    const runner: RunSubNodeFn = async (_pathId) => {
      concurrent++;
      maxSeen = Math.max(maxSeen, concurrent);
      // 비동기 yield 로 다른 Promise 에게 제어 양보
      await Promise.resolve();
      concurrent--;
      return { status: 'success', data: null };
    };

    const spec: ParallelNodeSpec = {
      id: 'proc',
      type: 'parallel',
      maxConcurrent: 2,
      branches: Array.from({ length: 5 }, (_, i) => ({
        id: `br${i}`,
        nodes: [{ id: `n${i}`, type: 'agent', role: 'planner' }],
      })),
    };

    await parallelHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    expect(maxSeen).toBeLessThanOrEqual(2);
  });

  // 6. branches 빈 배열 → 즉시 success, branches={}
  it('6. branches 빈 배열 → 즉시 success, branches={}', async () => {
    const spec = makeSpec({ branches: [] });
    const output = await parallelHandler.handle(spec, 'pipeline.0', successRunner(), makeOptions(bus, token));

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.status).toBe('completed');
    expect(data.branches).toEqual({});
  });

  // 7. CancellationToken 취소 → 대기 중인 branch 는 cancelled 로 반환
  it('7. token 취소 → 아직 시작 안 한 branch 는 aborted 처리', async () => {
    const runner: RunSubNodeFn = async (pathId) => {
      // 첫 번째 branch 를 처리하는 동안 token 취소
      if (pathId === 'pipeline.0.branches.0.nodes.0') {
        token.cancel('test cancel');
      }
      return { status: 'success', data: null };
    };
    // maxConcurrent=1 이면 branch 0 완료 후 branch 1, 2 가 취소 감지
    const spec = makeSpec({ maxConcurrent: 1 });

    const output = await parallelHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    // token 취소 시 continueOnFailure=false 이므로 전체 실패 또는 일부 ok=false
    // branch 0 은 success, branch 1 이후는 cancelled
    const data = output.data as Record<string, unknown>;
    const branches = data.branches as Record<string, { ok: boolean }>;
    // 취소된 branch 들은 ok=false
    expect(branches['b']?.ok).toBe(false);
    expect(branches['c']?.ok).toBe(false);
  });

  // 8. sub-node pathId 형식 검증 — parent/branch/node 네임스페이스
  it('8. sub-node pathId 가 {parentId}.branches.{idx}.nodes.{idx} 형식으로 전달됨', async () => {
    const receivedPathIds: string[] = [];
    const runner: RunSubNodeFn = async (pathId) => {
      receivedPathIds.push(pathId);
      return { status: 'success', data: null };
    };

    const spec: ParallelNodeSpec = {
      id: 'proc',
      type: 'parallel',
      branches: [
        { id: 'a', nodes: [{ id: 'a1', type: 'agent', role: 'planner' }, { id: 'a2', type: 'agent', role: 'planner' }] },
        { id: 'b', nodes: [{ id: 'b1', type: 'agent', role: 'planner' }] },
      ],
    };

    await parallelHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    expect(receivedPathIds).toContain('pipeline.0.branches.0.nodes.0');
    expect(receivedPathIds).toContain('pipeline.0.branches.0.nodes.1');
    expect(receivedPathIds).toContain('pipeline.0.branches.1.nodes.0');
    // branch 0 의 nodes 는 순차: a1 먼저, a2 나중
    const idxA1 = receivedPathIds.indexOf('pipeline.0.branches.0.nodes.0');
    const idxA2 = receivedPathIds.indexOf('pipeline.0.branches.0.nodes.1');
    expect(idxA1).toBeLessThan(idxA2);
  });

  // 이벤트 검증: flow.parallel.start / flow.branch.complete / flow.parallel.complete
  it('9. 이벤트 3종 정상 emit', async () => {
    const events: string[] = [];
    bus.on('*', (e) => { events.push(e.type); });

    const spec = makeSpec();
    await parallelHandler.handle(spec, 'pipeline.0', successRunner(), makeOptions(bus, token));

    expect(events).toContain('flow.parallel.start');
    expect(events.filter((t) => t === 'flow.branch.complete')).toHaveLength(3);
    expect(events).toContain('flow.parallel.complete');
  });

  // mergeStrategy: any_succeeds — 구현 예정 (현재는 all_must_pass 동작)
  it('10. mergeStrategy all_must_pass (default) — 1 failure → output failure', async () => {
    const spec = makeSpec({ mergeStrategy: 'all_must_pass' });
    const runner = failingRunner('pipeline.0.branches.0.nodes.0');

    const output = await parallelHandler.handle(spec, 'pipeline.0', runner, makeOptions(bus, token));

    expect(output.status).toBe('failure');
  });
});
