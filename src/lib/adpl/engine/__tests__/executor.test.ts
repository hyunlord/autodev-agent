import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { PipelineExecutor } from '../executor';
import { PipelineCompiler } from '../compiler';
import { StateStore } from '../state/store';
import { EventBus } from '../events/bus';
import { AdapterRegistry } from '../adapters/registry';
import { MockAdapter } from '../adapters/mock';
import { MemoryEventCollector } from '../events/subscribers/memory-collector';

function readYaml(name: string): string {
  return readFileSync(`examples/adpl/${name}`, 'utf-8');
}

const TRIGGER = {
  triggerId: 'tr1',
  type: 'task_created',
  firedAt: '2026-04-20T00:00:00.000Z',
};

const ALL_TYPES = [
  'agent', 'shell', 'http', 'webhook_out',
  'branch', 'parallel', 'loop', 'gate',
  'mcp', 'set', 'transform',
];

function makeExecutor() {
  const registry = new AdapterRegistry();
  const bus = new EventBus();
  const collector = new MemoryEventCollector().attach(bus);

  for (const t of ALL_TYPES) {
    registry.register(new MockAdapter({ type: t }));
  }

  const executor = new PipelineExecutor(
    new PipelineCompiler(),
    registry,
    new StateStore(),
    bus,
  );

  return { executor, registry, bus, collector };
}

describe('PipelineExecutor', () => {
  let executor: PipelineExecutor;
  let registry: AdapterRegistry;
  let collector: MemoryEventCollector;

  beforeEach(() => {
    ({ executor, registry, collector } = makeExecutor());
  });

  // ──────────────────────────────────────────────
  describe('basic execution', () => {
    it('01-hello-world: completes successfully', async () => {
      const result = await executor.run({
        pipelineYaml: readYaml('01-hello-world.yaml'),
        projectId: 'p1',
        pipelineVersionId: 'v1',
        taskId: 't1',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      });

      expect(result.status).toBe('completed');
      expect(result.completedNodes).toBe(1);
      expect(result.failedNodes).toBe(0);
      expect(result.runId).toBeTruthy();
      expect(result.totalDurationMs).toBeGreaterThan(0);
      expect(result.compileDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.executionDurationMs).toBeGreaterThan(0);
      expect(result.state).toBeDefined();
      expect(result.plan).toBeDefined();
      expect(result.pipelineVersionId).toBe('v1');
    });

    it('02-plan-code-verify: sequential 3 nodes complete', async () => {
      const result = await executor.run({
        pipelineYaml: readYaml('02-plan-code-verify.yaml'),
        projectId: 'p1',
        pipelineVersionId: 'v2',
        taskId: 't1',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      });

      expect(result.status).toBe('completed');
      expect(result.completedNodes).toBe(3);
      expect(result.failedNodes).toBe(0);
    });

    it('second run with same pipelineVersionId uses compile cache (both succeed)', async () => {
      const input = {
        pipelineYaml: readYaml('01-hello-world.yaml'),
        projectId: 'p1',
        pipelineVersionId: 'cached-v1',
        taskId: 't1',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      };

      const first = await executor.run(input);
      const second = await executor.run({ ...input, taskId: 't2' });

      expect(first.status).toBe('completed');
      expect(second.status).toBe('completed');
      // 각 run 은 독립적 runId
      expect(first.runId).not.toBe(second.runId);
      // 두 번째는 캐시 hit → compile 이 더 짧거나 같아야 함 (일반적으로)
      expect(second.compileDurationMs).toBeLessThanOrEqual(first.compileDurationMs + 5);
    });

    it('useCompileCache: false → sourcePath undefined, 여전히 성공', async () => {
      const result = await executor.run(
        {
          pipelineYaml: readYaml('01-hello-world.yaml'),
          projectId: 'p1',
          pipelineVersionId: 'no-cache-v1',
          taskId: 't1',
          triggerContext: TRIGGER,
          worktreeRoot: '/tmp/test-worktree',
        },
        { useCompileCache: false },
      );

      expect(result.status).toBe('completed');
    });
  });

  // ──────────────────────────────────────────────
  describe('failure handling', () => {
    it('adapter failure → pipeline status = failed', async () => {
      registry.register(
        new MockAdapter({
          type: 'shell',
          behavior: {
            result: {
              kind: 'failure',
              error: { code: 'test_error', message: 'simulated failure', category: 'persistent' },
            },
          },
        }),
      );

      const result = await executor.run({
        pipelineYaml: readYaml('01-hello-world.yaml'),
        projectId: 'p1',
        pipelineVersionId: 'fail-v1',
        taskId: 't1',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      });

      expect(result.status).toBe('failed');
      expect(result.failedNodes).toBe(1);
    });

    it('invalid YAML → compile throws', async () => {
      await expect(
        executor.run({
          pipelineYaml: 'not: valid: yaml: pipeline',
          projectId: 'p1',
          pipelineVersionId: 'bad-v1',
          taskId: 't1',
          triggerContext: TRIGGER,
          worktreeRoot: '/tmp/test-worktree',
        }),
      ).rejects.toThrow(/Compile failed/);
    });
  });

  // ──────────────────────────────────────────────
  describe('cancellation', () => {
    it('cancel during run → status = cancelled', async () => {
      // 느린 adapter 로 cancel 기회 확보
      registry.register(
        new MockAdapter({
          type: 'agent',
          behavior: { delayMs: 200 },
        }),
      );

      const runPromise = executor.run({
        pipelineYaml: readYaml('02-plan-code-verify.yaml'),
        projectId: 'p1',
        pipelineVersionId: 'cancel-v1',
        taskId: 't1',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      });

      // 첫 번째 node 실행 중 cancel
      setTimeout(() => {
        const activeRuns = Array.from(
          (executor as unknown as { activeTokens: Map<string, unknown> }).activeTokens.keys(),
        );
        if (activeRuns.length > 0) {
          executor.cancel(activeRuns[0], 'test cancel');
        }
      }, 50);

      const result = await runPromise;
      expect(result.status).toBe('cancelled');
    });

    it('cancel nonexistent run: no-op (no throw)', () => {
      expect(() => executor.cancel('nonexistent-id', 'test')).not.toThrow();
    });

    it('cancel already-cancelled run: no-op (no double emit)', async () => {
      registry.register(
        new MockAdapter({ type: 'agent', behavior: { delayMs: 200 } }),
      );

      const runPromise = executor.run({
        pipelineYaml: readYaml('02-plan-code-verify.yaml'),
        projectId: 'p1',
        pipelineVersionId: 'cancel-twice-v1',
        taskId: 't1',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      });

      setTimeout(() => {
        const activeRuns = Array.from(
          (executor as unknown as { activeTokens: Map<string, unknown> }).activeTokens.keys(),
        );
        if (activeRuns.length > 0) {
          executor.cancel(activeRuns[0], 'first cancel');
          executor.cancel(activeRuns[0], 'second cancel');
        }
      }, 50);

      const result = await runPromise;
      expect(result.status).toBe('cancelled');
      // run.cancelled 이벤트는 한 번만 발행
      expect(collector.ofType('run.cancelled')).toHaveLength(1);
    });

    it('cancel emits run.cancelled event', async () => {
      registry.register(
        new MockAdapter({ type: 'agent', behavior: { delayMs: 200 } }),
      );

      const runPromise = executor.run({
        pipelineYaml: readYaml('02-plan-code-verify.yaml'),
        projectId: 'p1',
        pipelineVersionId: 'cancel-evt-v1',
        taskId: 't1',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      });

      setTimeout(() => {
        const activeRuns = Array.from(
          (executor as unknown as { activeTokens: Map<string, unknown> }).activeTokens.keys(),
        );
        if (activeRuns.length > 0) {
          executor.cancel(activeRuns[0], 'event test');
        }
      }, 50);

      await runPromise;

      const cancelEvents = collector.ofType('run.cancelled');
      expect(cancelEvents).toHaveLength(1);
      expect(cancelEvents[0].reason).toBe('event test');
    });
  });

  // ──────────────────────────────────────────────
  describe('status / state 조회', () => {
    it('getStatus after completed run', async () => {
      const result = await executor.run({
        pipelineYaml: readYaml('01-hello-world.yaml'),
        projectId: 'p1',
        pipelineVersionId: 'status-v1',
        taskId: 't1',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      });

      const status = executor.getStatus(result.runId);
      expect(status).not.toBeNull();
      expect(status!.status).toBe('completed');
      expect(status!.nodesCompleted).toBe(1);
      expect(status!.nodesRunning).toBe(0);
      expect(status!.completedAt).toBeDefined();
    });

    it('getStatus for unknown runId → null', () => {
      expect(executor.getStatus('unknown-id')).toBeNull();
    });

    it('getState returns full PipelineRunState', async () => {
      const result = await executor.run({
        pipelineYaml: readYaml('01-hello-world.yaml'),
        projectId: 'p1',
        pipelineVersionId: 'state-v1',
        taskId: 't1',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      });

      const state = executor.getState(result.runId);
      expect(state).not.toBeNull();
      expect(state!.id).toBe(result.runId);
      expect(state!.nodes.size).toBeGreaterThan(0);
    });

    it('getState for unknown runId → null', () => {
      expect(executor.getState('unknown-id')).toBeNull();
    });
  });

  // ──────────────────────────────────────────────
  describe('activeRunCount', () => {
    it('0 before any run', () => {
      expect(executor.activeRunCount()).toBe(0);
    });

    it('decreases back to 0 after run completes', async () => {
      await executor.run({
        pipelineYaml: readYaml('01-hello-world.yaml'),
        projectId: 'p1',
        pipelineVersionId: 'ar-v1',
        taskId: 't1',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      });

      expect(executor.activeRunCount()).toBe(0);
    });

    it('decreases back to 0 after failed run', async () => {
      registry.register(
        new MockAdapter({
          type: 'shell',
          behavior: {
            result: { kind: 'failure', error: { code: 'e', message: 'm' } },
          },
        }),
      );

      await executor.run({
        pipelineYaml: readYaml('01-hello-world.yaml'),
        projectId: 'p1',
        pipelineVersionId: 'ar-fail-v1',
        taskId: 't1',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      });

      expect(executor.activeRunCount()).toBe(0);
    });
  });

  // ──────────────────────────────────────────────
  describe('RunInput type safety', () => {
    it('rejects RunInput without worktreeRoot at compile-time', () => {
      // @ts-expect-error worktreeRoot is required
      const _bad: import('../executor').RunInput = {
        pipelineYaml: 'x',
        projectId: 'p',
        pipelineVersionId: 'v',
        taskId: 't',
        triggerContext: {} as any,
      };
      expect(true).toBe(true); // runtime never reached; compile-time check only
    });
  });

  // ──────────────────────────────────────────────
  describe('events integration', () => {
    it('emits full event sequence for 01-hello-world', async () => {
      await executor.run({
        pipelineYaml: readYaml('01-hello-world.yaml'),
        projectId: 'p1',
        pipelineVersionId: 'evt-v1',
        taskId: 't1',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      });

      expect(collector.ofType('run.started')).toHaveLength(1);
      expect(collector.ofType('run.completed')).toHaveLength(1);
      expect(collector.ofType('node.ready')).toHaveLength(1);
      expect(collector.ofType('node.started')).toHaveLength(1);
      expect(collector.ofType('node.completed')).toHaveLength(1);
    });

    it('emits full event sequence for 02-plan-code-verify (3 nodes)', async () => {
      await executor.run({
        pipelineYaml: readYaml('02-plan-code-verify.yaml'),
        projectId: 'p1',
        pipelineVersionId: 'evt-v2',
        taskId: 't1',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      });

      expect(collector.ofType('run.started')).toHaveLength(1);
      expect(collector.ofType('run.completed')).toHaveLength(1);
      expect(collector.ofType('node.ready').length).toBeGreaterThanOrEqual(3);
      expect(collector.ofType('node.started').length).toBeGreaterThanOrEqual(3);
      expect(collector.ofType('node.completed').length).toBeGreaterThanOrEqual(3);
    });

    it('RunResult.state matches getState', async () => {
      const result = await executor.run({
        pipelineYaml: readYaml('01-hello-world.yaml'),
        projectId: 'p1',
        pipelineVersionId: 'state-match-v1',
        taskId: 't1',
        triggerContext: TRIGGER,
        worktreeRoot: '/tmp/test-worktree',
      });

      const state = executor.getState(result.runId);
      expect(result.state).toBe(state);
    });
  });
});
