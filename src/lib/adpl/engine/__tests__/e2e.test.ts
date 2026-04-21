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
