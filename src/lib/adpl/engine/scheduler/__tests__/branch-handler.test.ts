import { describe, it, expect, beforeEach } from 'vitest';
import { branchHandler } from '../handlers/branch-handler';
import type { FlowNodeOptions, RunSubNodeFn } from '../flow-handler';
import type { BranchNodeSpec } from '@/lib/adpl/types/nodes/branch';
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

// ─────────────────────────────────────────────────────────────────────────────
describe('branchHandler', () => {
  let bus: EventBus;
  let token: CancellationToken;

  beforeEach(() => {
    bus = new EventBus();
    token = new CancellationToken();
  });

  // ─────────────────────────────────────────────
  // 1. condition true → first case selected
  // ─────────────────────────────────────────────
  it('1. condition true (truthy field) → first case selected, then nodes executed', async () => {
    const executedPaths: string[] = [];
    const runner: RunSubNodeFn = async (pathId) => {
      executedPaths.push(pathId);
      return { status: 'success', data: 'then-result' };
    };

    const spec: BranchNodeSpec = {
      id: 'decide',
      type: 'branch',
      cases: [
        {
          when: { field: '$nodes.step1.data.ok', truthy: true },
          then: [{ id: 'then-node', type: 'agent', role: 'planner' }],
        },
        {
          default: true,
          then: [{ id: 'else-node', type: 'agent', role: 'planner' }],
        },
      ],
    };

    // $nodes 는 branch-handler 내부 minimalCtx 에서 빈 객체이므로
    // truthy: true 로 평가 시 undefined → falsy → false.
    // 반대로 truthy: false 는 true → case 선택됨.
    // spec 을 조정하여 확실하게 truthy=false (undefined 는 falsy → !false = true) 로 테스트.
    const specTruthyFalse: BranchNodeSpec = {
      id: 'decide',
      type: 'branch',
      cases: [
        {
          when: { field: '$nodes.step1.data.ok', truthy: false },
          then: [{ id: 'then-node', type: 'agent', role: 'planner' }],
        },
        {
          default: true,
          then: [{ id: 'else-node', type: 'agent', role: 'planner' }],
        },
      ],
    };

    const output = await branchHandler.handle(
      specTruthyFalse,
      'pipeline.0',
      runner,
      makeOptions(bus, token),
    );

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.selectedCase).toBe('case[0]');
    expect(executedPaths).toContain('pipeline.0.cases.0.then.0');
  });

  // ─────────────────────────────────────────────
  // 2. condition false → default case selected
  // ─────────────────────────────────────────────
  it('2. condition false → default case (else) executed', async () => {
    const executedPaths: string[] = [];
    const runner: RunSubNodeFn = async (pathId) => {
      executedPaths.push(pathId);
      return { status: 'success', data: 'default-result' };
    };

    // truthy: true with undefined field → false → falls through to default
    const spec: BranchNodeSpec = {
      id: 'decide',
      type: 'branch',
      cases: [
        {
          when: { field: '$nodes.step1.data.ok', truthy: true },
          then: [{ id: 'then-node', type: 'agent', role: 'planner' }],
        },
        {
          default: true,
          then: [{ id: 'default-node', type: 'agent', role: 'planner' }],
        },
      ],
    };

    const output = await branchHandler.handle(
      spec,
      'pipeline.0',
      runner,
      makeOptions(bus, token),
    );

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.selectedCase).toBe('default');
    expect(executedPaths).toContain('pipeline.0.cases.1.then.0');
    expect(executedPaths).not.toContain('pipeline.0.cases.0.then.0');
  });

  // ─────────────────────────────────────────────
  // 3. condition false + no default → skip (empty success)
  // ─────────────────────────────────────────────
  it('3. condition false + no default case → skip, result=undefined', async () => {
    const executedPaths: string[] = [];
    const runner: RunSubNodeFn = async (pathId) => {
      executedPaths.push(pathId);
      return { status: 'success', data: null };
    };

    const spec: BranchNodeSpec = {
      id: 'decide',
      type: 'branch',
      cases: [
        {
          when: { field: '$nodes.step1.data.ok', truthy: true },
          then: [{ id: 'then-node', type: 'agent', role: 'planner' }],
        },
      ],
    };

    const output = await branchHandler.handle(
      spec,
      'pipeline.0',
      runner,
      makeOptions(bus, token),
    );

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.selectedCase).toBeNull();
    expect(data.result).toBeUndefined();
    expect(executedPaths).toHaveLength(0);
  });

  // ─────────────────────────────────────────────
  // 4. condition eval throw → BRANCH_CONDITION_EVAL_FAILED
  // ─────────────────────────────────────────────
  it('4. condition that throws → output failure with BRANCH_CONDITION_EVAL_FAILED', async () => {
    // gt on non-numeric field → toNumber throws
    const spec: BranchNodeSpec = {
      id: 'decide',
      type: 'branch',
      cases: [
        {
          when: { field: '$nodes.s.val', gt: 5 },
          then: [{ id: 'n1', type: 'agent', role: 'planner' }],
        },
      ],
    };

    // $nodes is empty in minimal ctx → field resolves to undefined → Number(undefined) = NaN → throw
    const output = await branchHandler.handle(
      spec,
      'pipeline.0',
      successRunner(),
      makeOptions(bus, token),
    );

    expect(output.status).toBe('failure');
    expect(output.error?.code).toBe('BRANCH_CONDITION_EVAL_FAILED');
  });

  // ─────────────────────────────────────────────
  // 5. then inner node throws → propagated as failure
  // ─────────────────────────────────────────────
  it('5. then inner node failure → propagated to branch output', async () => {
    const spec: BranchNodeSpec = {
      id: 'decide',
      type: 'branch',
      cases: [
        {
          when: { field: '$nodes.s.ok', truthy: false },
          then: [{ id: 'inner-fail', type: 'agent', role: 'planner' }],
        },
      ],
    };

    const output = await branchHandler.handle(
      spec,
      'pipeline.0',
      failRunner('inner node failed'),
      makeOptions(bus, token),
    );

    expect(output.status).toBe('failure');
    expect(output.error?.message).toBe('inner node failed');
  });

  // ─────────────────────────────────────────────
  // 6. string condition → error thrown
  // ─────────────────────────────────────────────
  it('6. string condition → output failure (not supported until Stage 5)', async () => {
    const spec: BranchNodeSpec = {
      id: 'decide',
      type: 'branch',
      cases: [
        {
          // string condition — Stage 5 이전 미지원
          when: '$nodes.step1.data.score >= 80' as unknown as import('@/lib/adpl/types/expression').StructuredCondition,
          then: [{ id: 'n1', type: 'agent', role: 'planner' }],
        },
      ],
    };

    const output = await branchHandler.handle(
      spec,
      'pipeline.0',
      successRunner(),
      makeOptions(bus, token),
    );

    expect(output.status).toBe('failure');
  });

  // ─────────────────────────────────────────────
  // 7. onMissingMatch=error + no match → failure
  // ─────────────────────────────────────────────
  it('7. onMissingMatch=error + no match → failure with BRANCH_NO_MATCH', async () => {
    const spec: BranchNodeSpec = {
      id: 'decide',
      type: 'branch',
      onMissingMatch: 'error',
      cases: [
        {
          when: { field: '$nodes.s.val', eq: 'impossible' },
          then: [{ id: 'n1', type: 'agent', role: 'planner' }],
        },
      ],
    };

    const output = await branchHandler.handle(
      spec,
      'pipeline.0',
      successRunner(),
      makeOptions(bus, token),
    );

    expect(output.status).toBe('failure');
    expect(output.error?.code).toBe('BRANCH_NO_MATCH');
  });

  // ─────────────────────────────────────────────
  // 8. flow.branch.select event emitted
  // ─────────────────────────────────────────────
  it('8. flow.branch.select event is emitted on case selection', async () => {
    const events: Array<{ type: string; selectedCase: unknown }> = [];
    bus.on('flow.branch.select', (e) => {
      events.push({ type: e.type, selectedCase: (e as { selectedCase: unknown }).selectedCase });
    });

    const spec: BranchNodeSpec = {
      id: 'decide',
      type: 'branch',
      cases: [
        {
          default: true,
          then: [{ id: 'n1', type: 'agent', role: 'planner' }],
        },
      ],
    };

    await branchHandler.handle(spec, 'pipeline.0', successRunner(), makeOptions(bus, token));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('flow.branch.select');
    expect(events[0].selectedCase).toBe('default');
  });
});
