import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { PipelineExecutor } from '../executor';
import { PipelineCompiler } from '../compiler';
import { StateStore } from '../state/store';
import { EventBus } from '../events/bus';
import { AdapterRegistry } from '../adapters/registry';
import { MockAdapter } from '../adapters/mock';
import type { NodeOutput } from '@/lib/adpl/types';

const ALL_TYPES = [
  'agent', 'shell', 'http', 'webhook_out',
  'branch', 'parallel', 'loop', 'gate',
  'mcp', 'set', 'transform',
];

const TRIGGER = {
  triggerId: 'tr1',
  type: 'task_created' as const,
  firedAt: '2026-04-20T00:00:00.000Z',
};

/**
 * Stage 2 E2E 통합 테스트.
 * PipelineExecutor 로 Compile → Schedule → Execute → Complete 전 사이클 검증.
 */
describe('Stage 2 E2E — PipelineExecutor', () => {
  let executor: PipelineExecutor;
  let registry: AdapterRegistry;
  let bus: EventBus;
  let store: StateStore;

  beforeEach(() => {
    registry = new AdapterRegistry();
    bus = new EventBus();
    store = new StateStore();
    for (const t of ALL_TYPES) {
      registry.register(new MockAdapter({ type: t }));
    }
    executor = new PipelineExecutor(new PipelineCompiler(), registry, store, bus);
  });

  function makeInput(yamlFile: string) {
    return {
      pipelineYaml: readFileSync(`examples/adpl/${yamlFile}`, 'utf-8'),
      projectId: 'e2e-p',
      pipelineVersionId: `e2e-${yamlFile}-${Date.now()}`,
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    };
  }

  // ─────────────────────────────────────────────────────
  // 시나리오 1: Linear 5노드 전체 완주 (정의 순서대로 실행)
  // ─────────────────────────────────────────────────────
  it('1. Linear 5-node pipeline: all nodes complete in definition order', async () => {
    const executionOrder: string[] = [];

    registry.register(
      new MockAdapter({
        type: 'agent',
        behavior: {
          executeCallback: async (spec): Promise<NodeOutput> => {
            executionOrder.push(spec.id);
            return { status: 'success', data: null };
          },
        },
      }),
    );

    const yaml = `
adplVersion: 1
name: linear-5
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: a
    type: agent
    role: planner
  - id: b
    type: agent
    role: planner
  - id: c
    type: agent
    role: planner
  - id: d
    type: agent
    role: planner
  - id: e
    type: agent
    role: planner
settings:
  maxParallel: 5
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'linear-5-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    expect(result.status).toBe('completed');
    expect(result.completedNodes).toBe(5);
    expect(result.failedNodes).toBe(0);
    // 순차 의존(siblings) → a→b→c→d→e 순서 보장
    expect(executionOrder).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 2: Abort 정책 — plan 실패 시 code/verify skip
  // ─────────────────────────────────────────────────────
  it('2. Abort policy: failed node causes downstream to be skipped', async () => {
    registry.register(
      new MockAdapter({
        type: 'agent',
        behavior: {
          executeCallback: async (spec): Promise<NodeOutput> => {
            if (spec.id === 'plan') {
              return {
                status: 'failure',
                error: { code: 'test_fail', message: 'plan fail', category: 'persistent' },
              };
            }
            return { status: 'success', data: null };
          },
        },
      }),
    );

    const result = await executor.run(makeInput('02-plan-code-verify.yaml'), {
      scheduler: { defaultOnError: 'abort' },
    });

    expect(result.status).toBe('failed');
    expect(result.failedNodes).toBe(1);
    expect(result.skippedNodes).toBe(2); // code, verify → pending → skipped (finalize)
    expect(result.completedNodes).toBe(0);
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 3: Continue 정책 — plan 실패 후에도 code/verify 실행
  // ─────────────────────────────────────────────────────
  it('3. Continue policy: downstream runs even after upstream failure', async () => {
    registry.register(
      new MockAdapter({
        type: 'agent',
        behavior: {
          executeCallback: async (spec): Promise<NodeOutput> => {
            if (spec.id === 'plan') {
              return {
                status: 'failure',
                error: { code: 'test_fail', message: 'plan fail', category: 'persistent' },
              };
            }
            return { status: 'success', data: null };
          },
        },
      }),
    );

    const result = await executor.run(makeInput('02-plan-code-verify.yaml'), {
      scheduler: { defaultOnError: 'continue' },
    });

    expect(result.status).toBe('failed'); // 실패 노드 존재 → failed
    expect(result.failedNodes).toBe(1);
    expect(result.completedNodes).toBe(2); // code, verify 실행 완료
    expect(result.skippedNodes).toBe(0);
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 4: Timeout — timeout: 1s + delayMs: 2000 → failure(timeout)
  // ─────────────────────────────────────────────────────
  it('4. Timeout: node exceeding timeout returns failure with timeout category', async () => {
    registry.register(
      new MockAdapter({
        type: 'agent',
        behavior: { delayMs: 2000 }, // 2초 지연
      }),
    );

    const yaml = `
adplVersion: 1
name: timeout-test
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: slow-task
    type: agent
    role: planner
    timeout: 1
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'timeout-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    expect(result.status).toBe('failed');
    expect(result.failedNodes).toBe(1);

    const failedNode = Array.from(result.state.nodes.values()).find(
      (n) => n.status === 'failure',
    );
    expect(failedNode?.error?.code).toBe('timeout');
    expect(failedNode?.error?.category).toBe('timeout');
  }, 10_000);

  // ─────────────────────────────────────────────────────
  // 시나리오 5: Retry — transient 실패 2회 후 3번째 성공
  // ─────────────────────────────────────────────────────
  it('5. Retry: transient failure recovers on 3rd attempt', async () => {
    let callCount = 0;

    registry.register(
      new MockAdapter({
        type: 'agent',
        behavior: {
          executeCallback: async (): Promise<NodeOutput> => {
            callCount++;
            if (callCount < 3) {
              return {
                status: 'failure',
                error: { code: 'flaky', message: 'transient error', category: 'transient' },
              };
            }
            return { status: 'success', data: 'recovered' };
          },
        },
      }),
    );

    // initialDelay: 1 (초) = 1000ms — Zod requires int
    const yaml = `
adplVersion: 1
name: retry-test
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: flaky
    type: agent
    role: planner
    retryPolicy:
      maxAttempts: 3
      backoff: fixed
      initialDelay: 1
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'retry-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    expect(result.status).toBe('completed');
    expect(callCount).toBe(3); // 1실패 + 2실패 + 3성공
  }, 15_000);

  // ─────────────────────────────────────────────────────
  // 시나리오 6: Cancellation — 실행 중 취소 → cancelled
  // ─────────────────────────────────────────────────────
  it('6. Cancel during run: pipeline transitions to cancelled', async () => {
    registry.register(
      new MockAdapter({
        type: 'agent',
        behavior: { delayMs: 300 },
      }),
    );

    const runPromise = executor.run(makeInput('02-plan-code-verify.yaml'));

    // 100ms 후 activeTokens 에서 runId 추출 후 cancel (기존 cancel 테스트 패턴)
    setTimeout(() => {
      const activeRuns = Array.from(
        (executor as unknown as { activeTokens: Map<string, unknown> }).activeTokens.keys(),
      );
      if (activeRuns.length > 0) {
        executor.cancel(activeRuns[0], 'user test cancel');
      }
    }, 100);

    const result = await runPromise;
    expect(result.status).toBe('cancelled');
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 7: maxParallel — 순차 의존 파이프라인은 동시 실행 1
  // ─────────────────────────────────────────────────────
  it('7. maxParallel: sequential deps cap concurrent execution at 1', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    registry.register(
      new MockAdapter({
        type: 'agent',
        behavior: {
          executeCallback: async (): Promise<NodeOutput> => {
            currentConcurrent++;
            maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
            await new Promise<void>((r) => setTimeout(r, 20));
            currentConcurrent--;
            return { status: 'success', data: null };
          },
        },
      }),
    );

    // 02 는 plan→code→verify 순차 의존, settings.maxParallel: 1
    const result = await executor.run(makeInput('02-plan-code-verify.yaml'));

    expect(result.status).toBe('completed');
    expect(maxConcurrent).toBe(1); // 순차 의존 → 동시 실행 불가
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 8: 의존성 체인 순서 — plan 완료 전 code 시작 안 됨
  // ─────────────────────────────────────────────────────
  it('8. Dependency chain: nodes start and end in topological order', async () => {
    const startOrder: string[] = [];
    const endOrder: string[] = [];

    registry.register(
      new MockAdapter({
        type: 'agent',
        behavior: {
          executeCallback: async (spec): Promise<NodeOutput> => {
            startOrder.push(spec.id);
            await new Promise<void>((r) => setTimeout(r, 10));
            endOrder.push(spec.id);
            return { status: 'success', data: null };
          },
        },
      }),
    );

    const result = await executor.run(makeInput('02-plan-code-verify.yaml'));

    expect(result.status).toBe('completed');
    expect(startOrder).toEqual(['plan', 'code', 'verify']);
    expect(endOrder).toEqual(['plan', 'code', 'verify']);
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 9: Plan→Code→Verify — verify 노드가 $nodes.code 출력에 접근 가능
  // ─────────────────────────────────────────────────────
  it('9. Plan→Code→Verify: verify node receives code node output in $nodes', async () => {
    const codeOutput = { text: 'generated code', modifiedFiles: ['src/foo.ts'] };
    let verifyCtxCapture: Record<string, NodeOutput> | null = null;

    registry.register(
      new MockAdapter({
        type: 'agent',
        behavior: {
          executeCallback: async (spec, context): Promise<NodeOutput> => {
            if (spec.id === 'code') {
              return {
                status: 'success',
                data: codeOutput,
                metrics: { durationMs: 100, agentModel: 'claude-code' },
              };
            }
            if (spec.id === 'verify') {
              verifyCtxCapture = { ...context.$nodes };
            }
            return { status: 'success', data: null };
          },
        },
      }),
    );

    const result = await executor.run(makeInput('02-plan-code-verify.yaml'));

    expect(result.status).toBe('completed');
    expect(verifyCtxCapture).not.toBeNull();
    expect(verifyCtxCapture!['code']).toBeDefined();
    expect((verifyCtxCapture!['code'] as NodeOutput).data).toEqual(codeOutput);
    expect((verifyCtxCapture!['code'] as NodeOutput).metrics?.agentModel).toBe('claude-code');
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 10: parallel fail-fast E2E — 1 branch 실패 → 파이프라인 실패
  // ─────────────────────────────────────────────────────
  it('10. parallel fail-fast: 1 branch 실패 → 파이프라인 failed', async () => {
    registry.register(
      new MockAdapter({
        type: 'shell',
        behavior: {
          executeCallback: async (spec): Promise<NodeOutput> => {
            if (spec.id === 'test-run') {
              return {
                status: 'failure',
                error: { code: 'test_fail', message: 'tests failed', category: 'persistent' },
              };
            }
            return { status: 'success', data: null };
          },
        },
      }),
    );

    const yaml = `
adplVersion: 1
name: parallel-fail-fast
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: checks
    type: parallel
    branches:
      - id: lint
        nodes:
          - id: lint-run
            type: shell
            command: pnpm lint
      - id: test
        nodes:
          - id: test-run
            type: shell
            command: pnpm test
      - id: tsc
        nodes:
          - id: tsc-run
            type: shell
            command: pnpm tsc
settings:
  maxParallel: 4
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'parallel-fail-fast-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    expect(result.status).toBe('failed');
    expect(result.failedNodes).toBeGreaterThanOrEqual(1);
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 11: parallel continueOnBranchFailure E2E
  // 1 branch 실패 → 나머지 계속, branchFailures 저장
  // ─────────────────────────────────────────────────────
  it('11. parallel continueOnBranchFailure: 1 branch 실패 → 나머지 완료, 파이프라인 계속', async () => {
    const executedNodes: string[] = [];

    registry.register(
      new MockAdapter({
        type: 'shell',
        behavior: {
          executeCallback: async (spec): Promise<NodeOutput> => {
            executedNodes.push(spec.id);
            if (spec.id === 'test-run') {
              return {
                status: 'failure',
                error: { code: 'test_fail', message: 'tests failed', category: 'persistent' },
              };
            }
            return { status: 'success', data: null };
          },
        },
      }),
    );

    const yaml = `
adplVersion: 1
name: parallel-continue
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: checks
    type: parallel
    onError: continue
    branches:
      - id: lint
        nodes:
          - id: lint-run
            type: shell
            command: pnpm lint
      - id: test
        nodes:
          - id: test-run
            type: shell
            command: pnpm test
      - id: tsc
        nodes:
          - id: tsc-run
            type: shell
            command: pnpm tsc
  - id: notify
    type: agent
    role: planner
settings:
  maxParallel: 4
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'parallel-continue-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    // lint-run, tsc-run 은 실행됨
    expect(executedNodes).toContain('lint-run');
    expect(executedNodes).toContain('tsc-run');
    expect(executedNodes).toContain('test-run');

    // parallel 자체가 failure(partial) → 파이프라인은 failed
    expect(result.status).toBe('failed');

    // parallel 노드 output 에 branchFailures 존재 확인
    const parallelNodeState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId === 'pipeline.0',
    );
    expect(parallelNodeState).toBeDefined();
    const data = parallelNodeState!.output?.data as Record<string, unknown> | undefined;
    expect(data?.branchFailures).toBeDefined();
    expect((data?.branchFailures as Array<{ branchId: string }>).some((f) => f.branchId === 'test')).toBe(true);
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 12: branch then 선택 E2E
  // truthy: false 조건 (undefined field) → case[0] 선택 → branch 노드 success
  // branch handler output 에 selectedCase='case[0]' 확인
  // ─────────────────────────────────────────────────────
  it('12. branch then 선택: 조건 매칭 → branch 노드 success, selectedCase=case[0]', async () => {
    // branch handler 내 minimal ctx 의 $nodes 는 빈 객체 →
    // '$nodes.prepare.data.flag' → undefined → truthy: false → true → case[0] 선택
    const yaml = `
adplVersion: 1
name: branch-then-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: prepare
    type: agent
    role: planner
  - id: decide
    type: branch
    dependsOn: [prepare]
    cases:
      - when:
          field: '$nodes.prepare.data.flag'
          truthy: false
        then:
          - id: then-action
            type: agent
            role: planner
      - default: true
        then:
          - id: else-action
            type: agent
            role: planner
settings:
  maxParallel: 2
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'branch-then-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    expect(result.status).toBe('completed');

    // branch 노드(pipeline.1) output 확인 — selectedCase='case[0]' (then 선택)
    const branchNodeState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId === 'pipeline.1',
    );
    expect(branchNodeState).toBeDefined();
    expect(branchNodeState!.status).toBe('success');
    const data = branchNodeState!.output?.data as Record<string, unknown> | undefined;
    expect(data?.selectedCase).toBe('case[0]');
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 13: branch else 선택 E2E
  // truthy: true 조건 (undefined field) → 불일치 → default 선택
  // branch handler output 에 selectedCase='default' 확인
  // ─────────────────────────────────────────────────────
  it('13. branch else 선택: 조건 불일치 → default case 선택, selectedCase=default', async () => {
    // '$nodes.prepare.data.flag' → undefined → truthy: true → false → no match → default 선택
    const yaml = `
adplVersion: 1
name: branch-else-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: prepare
    type: agent
    role: planner
  - id: decide
    type: branch
    dependsOn: [prepare]
    cases:
      - when:
          field: '$nodes.prepare.data.flag'
          truthy: true
        then:
          - id: then-action
            type: agent
            role: planner
      - default: true
        then:
          - id: else-action
            type: agent
            role: planner
settings:
  maxParallel: 2
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'branch-else-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    expect(result.status).toBe('completed');

    // branch 노드(pipeline.1) output 확인 — selectedCase='default' (else 선택)
    const branchNodeState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId === 'pipeline.1',
    );
    expect(branchNodeState).toBeDefined();
    expect(branchNodeState!.status).toBe('success');
    const data = branchNodeState!.output?.data as Record<string, unknown> | undefined;
    expect(data?.selectedCase).toBe('default');
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 14: forEach loop E2E
  // items 3개 배열 → loop 노드 success, iterations 길이 3 확인
  // ─────────────────────────────────────────────────────
  it('14. forEach loop: items 3개 → loop 노드 success, iterationCount=3', async () => {
    const yaml = `
adplVersion: 1
name: foreach-loop-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: process
    type: loop
    mode: forEach
    over: '["item-a","item-b","item-c"]'
    as: current
    do:
      - id: work
        type: agent
        role: planner
settings:
  maxParallel: 2
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'foreach-loop-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    expect(result.status).toBe('completed');

    // loop 노드(pipeline.0) output 확인
    const loopNodeState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId === 'pipeline.0',
    );
    expect(loopNodeState).toBeDefined();
    expect(loopNodeState!.status).toBe('success');
    const data = loopNodeState!.output?.data as Record<string, unknown> | undefined;
    expect(data?.iterationCount).toBe(3);
    expect(data?.terminated).toBe('complete');
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 15: while loop E2E
  // condition 없음 → 1회 실행 후 종료, iterationCount=1
  // ─────────────────────────────────────────────────────
  it('15. while loop: condition 없음 → 1회 실행, iterationCount=1', async () => {
    const yaml = `
adplVersion: 1
name: while-loop-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: once
    type: loop
    mode: while
    maxIterations: 10
    do:
      - id: step
        type: agent
        role: planner
settings:
  maxParallel: 2
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'while-loop-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    expect(result.status).toBe('completed');

    const loopNodeState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId === 'pipeline.0',
    );
    expect(loopNodeState).toBeDefined();
    expect(loopNodeState!.status).toBe('success');
    const data = loopNodeState!.output?.data as Record<string, unknown> | undefined;
    expect(data?.iterationCount).toBe(1);
    expect(data?.terminated).toBe('complete');
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 16: gate pass E2E — condition truthy:false (undefined) → passes
  // ─────────────────────────────────────────────────────
  it('16. gate pass: condition truthy:false on undefined field → gate passes, pipeline completed', async () => {
    const executedNodes: string[] = [];

    registry.register(
      new MockAdapter({
        type: 'agent',
        behavior: {
          executeCallback: async (spec): Promise<NodeOutput> => {
            executedNodes.push(spec.id);
            return { status: 'success', data: null };
          },
        },
      }),
    );

    const yaml = `
adplVersion: 1
name: gate-pass-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: build
    type: agent
    role: planner
  - id: quality-check
    type: gate
    dependsOn: [build]
    condition:
      field: '$nodes.build.data.blocked'
      truthy: false
    onFail: fail_node
  - id: deploy
    type: agent
    role: planner
    dependsOn: [quality-check]
settings:
  maxParallel: 2
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'gate-pass-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    expect(result.status).toBe('completed');
    expect(executedNodes).toContain('build');
    expect(executedNodes).toContain('deploy');

    // gate 노드(pipeline.1) output 확인
    const gateNodeState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId === 'pipeline.1',
    );
    expect(gateNodeState).toBeDefined();
    expect(gateNodeState!.status).toBe('success');
    const data = gateNodeState!.output?.data as Record<string, unknown> | undefined;
    expect(data?.passed).toBe(true);
    expect(data?.gateId).toBe('quality-check');
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 17: gate fail_node E2E — condition truthy:true (undefined) → fails
  // downstream 노드는 abort 정책으로 skip
  // ─────────────────────────────────────────────────────
  it('17. gate fail_node: condition truthy:true on undefined → gate fails, deploy skipped', async () => {
    const executedNodes: string[] = [];

    registry.register(
      new MockAdapter({
        type: 'agent',
        behavior: {
          executeCallback: async (spec): Promise<NodeOutput> => {
            executedNodes.push(spec.id);
            return { status: 'success', data: null };
          },
        },
      }),
    );

    const yaml = `
adplVersion: 1
name: gate-fail-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: build
    type: agent
    role: planner
  - id: strict-gate
    type: gate
    dependsOn: [build]
    condition:
      field: '$nodes.build.data.score'
      truthy: true
    onFail: fail_node
    message: 'Score must be truthy to proceed'
  - id: deploy
    type: agent
    role: planner
    dependsOn: [strict-gate]
settings:
  maxParallel: 2
`;

    const result = await executor.run(
      {
        pipelineYaml: yaml,
        projectId: 'e2e-p',
        pipelineVersionId: 'gate-fail-v1',
        taskId: 'e2e-t',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      },
      { scheduler: { defaultOnError: 'abort' } },
    );

    expect(result.status).toBe('failed');
    expect(result.failedNodes).toBeGreaterThanOrEqual(1);
    // build 은 실행됨, deploy 는 abort 로 skip
    expect(executedNodes).toContain('build');
    expect(executedNodes).not.toContain('deploy');

    // gate 노드 failure 확인
    const gateNodeState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId === 'pipeline.1',
    );
    expect(gateNodeState?.status).toBe('failure');
    expect(gateNodeState?.error?.code).toBe('GATE_CONDITION_FAILED');
    expect(gateNodeState?.error?.message).toBe('Score must be truthy to proceed');
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 18: gate + all combinator E2E
  // all: [ truthy:false, truthy:false ] → both undefined → both true → gate passes
  // ─────────────────────────────────────────────────────
  it('18. gate all-combinator: both conditions pass → gate passes, pipeline completed', async () => {
    const executedNodes: string[] = [];

    registry.register(
      new MockAdapter({
        type: 'agent',
        behavior: {
          executeCallback: async (spec): Promise<NodeOutput> => {
            executedNodes.push(spec.id);
            return { status: 'success', data: null };
          },
        },
      }),
    );

    const yaml = `
adplVersion: 1
name: gate-all-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: prepare
    type: agent
    role: planner
  - id: multi-check
    type: gate
    dependsOn: [prepare]
    condition:
      all:
        - field: '$nodes.prepare.data.lintOk'
          truthy: false
        - field: '$nodes.prepare.data.testOk'
          truthy: false
    onFail: fail_node
  - id: release
    type: agent
    role: planner
    dependsOn: [multi-check]
settings:
  maxParallel: 2
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'gate-all-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    expect(result.status).toBe('completed');
    expect(executedNodes).toContain('prepare');
    expect(executedNodes).toContain('release');

    const gateNodeState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId === 'pipeline.1',
    );
    expect(gateNodeState?.status).toBe('success');
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 19: parallel 내 branch (중첩 flow node — Stage 4 통합 E2E)
  // track-a: branch 분기 (undefined field → truthy:false 매칭 → coder-a 실행)
  // track-b: 단순 agent
  // ─────────────────────────────────────────────────────
  it('19. parallel→branch: parallel 두 브랜치 동시 실행, track-a 내 branch 분기 정상', async () => {
    const yaml = `
adplVersion: 1
name: parallel-branch-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: setup
    type: agent
    role: planner
  - id: multi-process
    type: parallel
    dependsOn: [setup]
    branches:
      - id: track-a
        nodes:
          - id: decide-a
            type: branch
            cases:
              - when:
                  field: '$nodes.setup.data.skip'
                  truthy: false
                then:
                  - id: coder-a
                    type: agent
                    role: planner
              - default: true
                then:
                  - id: reviewer-a
                    type: agent
                    role: planner
      - id: track-b
        nodes:
          - id: analyzer-b
            type: agent
            role: planner
settings:
  maxParallel: 4
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'parallel-branch-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    expect(result.status).toBe('completed');

    // parallel 노드(pipeline.1) 성공 확인
    const parallelState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId === 'pipeline.1',
    );
    expect(parallelState?.status).toBe('success');

    // branch 노드(track-a 내 decide-a) pathId: pipeline.1.branches.0.nodes.0
    const branchState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId === 'pipeline.1.branches.0.nodes.0',
    );
    expect(branchState?.status).toBe('success');
    const branchData = branchState?.output?.data as Record<string, unknown> | undefined;
    expect(branchData?.selectedCase).toBe('case[0]');
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 20: loop 내 parallel (중첩 flow node — Stage 4 통합 E2E)
  // times 2회 loop, 각 iteration 에서 parallel 2 브랜치 실행
  // ─────────────────────────────────────────────────────
  it('20. loop→parallel: times loop 2회, 각 iteration 에서 parallel 2 브랜치 동시 실행', async () => {
    const yaml = `
adplVersion: 1
name: loop-parallel-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: batch-loop
    type: loop
    mode: times
    count: 2
    do:
      - id: par-work
        type: parallel
        branches:
          - id: coder
            nodes:
              - id: code-node
                type: agent
                role: planner
          - id: reviewer
            nodes:
              - id: review-node
                type: agent
                role: planner
settings:
  maxParallel: 4
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'loop-parallel-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    expect(result.status).toBe('completed');

    // loop 노드(pipeline.0) 성공 + 2회 반복 확인
    const loopState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId === 'pipeline.0',
    );
    expect(loopState?.status).toBe('success');
    const loopData = loopState?.output?.data as Record<string, unknown> | undefined;
    expect(loopData?.iterationCount).toBe(2);
    expect(loopData?.terminated).toBe('complete');
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 21a: branch 내 loop — condition 매칭 → times loop 3회
  // ─────────────────────────────────────────────────────
  it('21a. branch→loop (condition match): truthy:false → loop 3회 실행', async () => {
    const yaml = `
adplVersion: 1
name: branch-loop-match-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: plan
    type: agent
    role: planner
  - id: maybe-iterate
    type: branch
    dependsOn: [plan]
    cases:
      - when:
          field: '$nodes.plan.data.iterate'
          truthy: false
        then:
          - id: iter-loop
            type: loop
            mode: times
            count: 3
            do:
              - id: iter-step
                type: agent
                role: planner
      - default: true
        then:
          - id: fallback-step
            type: agent
            role: planner
settings:
  maxParallel: 2
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'branch-loop-match-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    expect(result.status).toBe('completed');

    // branch 노드(pipeline.1) case[0] 선택
    const branchState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId === 'pipeline.1',
    );
    expect(branchState?.status).toBe('success');
    const branchData = branchState?.output?.data as Record<string, unknown> | undefined;
    expect(branchData?.selectedCase).toBe('case[0]');

    // loop 노드(iter-loop) pathId: pipeline.1.cases.0.then.0
    const loopState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId === 'pipeline.1.cases.0.then.0',
    );
    expect(loopState?.status).toBe('success');
    const loopData = loopState?.output?.data as Record<string, unknown> | undefined;
    expect(loopData?.iterationCount).toBe(3);
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 21b: branch 내 loop — condition 불일치 → default(fallback) 실행
  // ─────────────────────────────────────────────────────
  it('21b. branch→loop (default): truthy:true on null → default case, fallback-step 실행', async () => {
    const yaml = `
adplVersion: 1
name: branch-loop-default-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: plan
    type: agent
    role: planner
  - id: maybe-iterate
    type: branch
    dependsOn: [plan]
    cases:
      - when:
          field: '$nodes.plan.data.iterate'
          truthy: true
        then:
          - id: iter-loop
            type: loop
            mode: times
            count: 3
            do:
              - id: iter-step
                type: agent
                role: planner
      - default: true
        then:
          - id: fallback-step
            type: agent
            role: planner
settings:
  maxParallel: 2
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-p',
      pipelineVersionId: 'branch-loop-default-v1',
      taskId: 'e2e-t',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree',
    });

    expect(result.status).toBe('completed');

    // branch default 선택
    const branchState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId === 'pipeline.1',
    );
    expect(branchState?.status).toBe('success');
    const branchData = branchState?.output?.data as Record<string, unknown> | undefined;
    expect(branchData?.selectedCase).toBe('default');

    // loop 는 실행되지 않음
    const loopState = Array.from(result.state.nodes.values()).find(
      (n) => n.nodeId?.includes('iter-loop'),
    );
    expect(loopState).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────
  // 추가: 10 샘플 YAML smoke test
  // executor.run() 으로 전수 실행 — throw 없이 완료/실패 반환 확인
  // ─────────────────────────────────────────────────────
  describe('10 sample YAML smoke tests', () => {
    const sampleFiles = readdirSync('examples/adpl')
      .filter((f) => f.endsWith('.yaml'))
      .sort();

    // v1 Scheduler 는 flow 내부 실행 미지원 → flow 노드는 MockAdapter 가 success 반환.
    // 일부 샘플은 flow 내 조건 분기 등 복잡 구조 → completed/failed 모두 허용.
    for (const file of sampleFiles) {
      it(`smoke: ${file}`, async () => {
        const result = await executor.run(makeInput(file));
        expect(['completed', 'failed']).toContain(result.status);
        expect(result.runId).toBeTruthy();
        expect(result.plan).toBeDefined();
        expect(result.state).toBeDefined();
      });
    }
  });
});
