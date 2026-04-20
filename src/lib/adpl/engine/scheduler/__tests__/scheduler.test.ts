import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { PipelineCompiler } from '../../compiler';
import { StateStore } from '../../state/store';
import { EventBus } from '../../events/bus';
import { MemoryEventCollector } from '../../events/subscribers/memory-collector';
import { CancellationToken } from '../../cancel/token';
import { Scheduler } from '../index';
import { MockWorker } from '../mock-worker';

async function setupRun(sampleFile: string) {
  const compiler = new PipelineCompiler();
  const yaml = readFileSync(`examples/adpl/${sampleFile}`, 'utf-8');
  const result = await compiler.compile(yaml);
  if (!result.ok) {
    throw new Error(`Compile failed: ${result.errors.map((e) => e.message).join(', ')}`);
  }
  const plan = result.plan;

  const store = new StateStore();
  const state = store.create(plan);
  const bus = new EventBus();
  const token = new CancellationToken();
  const collector = new MemoryEventCollector();
  collector.attach(bus);

  return { plan, state, store, bus, token, collector };
}

// ─── basic execution ──────────────────────────────────────────────────────────

describe('Scheduler — basic execution', () => {
  it('01-hello-world: single node succeeds', async () => {
    const { plan, state, store, bus, token } = await setupRun('01-hello-world.yaml');
    const worker = new MockWorker();
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);

    const result = await scheduler.run();

    expect(result.status).toBe('completed');
    expect(result.completedNodes).toBe(1);
    expect(worker.executeCount).toBe(1);
    expect(store.get(state.id)!.status).toBe('completed');
  });

  it('02-plan-code-verify: sequential 3 nodes in order', async () => {
    const { plan, state, store, bus, token } = await setupRun('02-plan-code-verify.yaml');
    const worker = new MockWorker();
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);

    const result = await scheduler.run();

    expect(result.status).toBe('completed');
    expect(result.completedNodes).toBe(3);
    expect(worker.executedNodes).toEqual(['pipeline.0', 'pipeline.1', 'pipeline.2']);
  });

  it('emits run.started + run.completed events', async () => {
    const { plan, state, store, bus, token, collector } = await setupRun('01-hello-world.yaml');
    const worker = new MockWorker();
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);

    await scheduler.run();

    const started = collector.ofType('run.started');
    const completed = collector.ofType('run.completed');
    expect(started).toHaveLength(1);
    expect(completed).toHaveLength(1);
    expect(completed[0].status).toBe('success');
  });

  it('emits node.ready + node.started + node.completed per node', async () => {
    const { plan, state, store, bus, token, collector } = await setupRun('02-plan-code-verify.yaml');
    const worker = new MockWorker();
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);

    await scheduler.run();

    expect(collector.ofType('node.ready')).toHaveLength(3);
    expect(collector.ofType('node.started')).toHaveLength(3);
    expect(collector.ofType('node.completed')).toHaveLength(3);
  });
});

// ─── failure handling ─────────────────────────────────────────────────────────

describe('Scheduler — failure handling', () => {
  it('single node failure → pipeline failed', async () => {
    const { plan, state, store, bus, token } = await setupRun('01-hello-world.yaml');
    const worker = new MockWorker({
      defaultResult: {
        status: 'failure',
        error: { code: 'test', message: 'simulated', category: 'persistent' },
      },
    });
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);

    const result = await scheduler.run();

    expect(result.status).toBe('failed');
    expect(result.failedNodes).toBe(1);
    expect(store.get(state.id)!.status).toBe('failed');
  });

  it('abort policy: downstream nodes skipped on failure', async () => {
    const { plan, state, store, bus, token } = await setupRun('02-plan-code-verify.yaml');
    const worker = new MockWorker({
      nodeResults: {
        'pipeline.0': {
          status: 'failure',
          error: { code: 'test', message: 'plan failed', category: 'persistent' },
        },
      },
    });
    const scheduler = new Scheduler(plan, state, store, worker, bus, token, {
      defaultOnError: 'abort',
    });

    const result = await scheduler.run();

    expect(result.status).toBe('failed');
    expect(result.failedNodes).toBe(1);
    expect(result.skippedNodes).toBe(2);
    expect(worker.executedNodes).toEqual(['pipeline.0']);
  });

  it('continue policy: downstream executed even on failure', async () => {
    const { plan, state, store, bus, token } = await setupRun('02-plan-code-verify.yaml');
    const worker = new MockWorker({
      nodeResults: {
        'pipeline.0': {
          status: 'failure',
          error: { code: 'test', message: 'plan failed', category: 'persistent' },
        },
      },
    });
    const scheduler = new Scheduler(plan, state, store, worker, bus, token, {
      defaultOnError: 'continue',
    });

    const result = await scheduler.run();

    expect(result.status).toBe('failed');
    expect(result.completedNodes).toBe(2);
    expect(worker.executedNodes).toEqual(['pipeline.0', 'pipeline.1', 'pipeline.2']);
  });

  it('worker throws → treated as worker_crash failure', async () => {
    const { plan, state, store, bus, token } = await setupRun('01-hello-world.yaml');
    const worker = new MockWorker({
      nodeResults: {
        'pipeline.0': () => {
          throw new Error('worker bug');
        },
      },
    });
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);

    const result = await scheduler.run();

    expect(result.status).toBe('failed');
    expect(store.getNode(state.id, 'pipeline.0')!.error?.code).toBe('worker_crash');
  });
});

// ─── cancellation ─────────────────────────────────────────────────────────────

describe('Scheduler — cancellation', () => {
  it('cancel before run: pipeline cancelled immediately, worker not called', async () => {
    const { plan, state, store, bus, token } = await setupRun('02-plan-code-verify.yaml');
    const worker = new MockWorker();
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);

    token.cancel('pre-cancel');
    const result = await scheduler.run();

    expect(result.status).toBe('cancelled');
    expect(worker.executeCount).toBe(0);
  });

  it('cancel during run: remaining nodes cancelled', async () => {
    const { plan, state, store, bus, token } = await setupRun('02-plan-code-verify.yaml');
    const worker = new MockWorker({
      delayMs: 50,
      onExecute: (nodeId) => {
        if (nodeId === 'pipeline.0') {
          setTimeout(() => token.cancel('mid-run'), 10);
        }
      },
    });
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);

    const result = await scheduler.run();

    expect(result.status).toBe('cancelled');
    expect(result.cancelledNodes).toBeGreaterThan(0);
  });
});

// ─── concurrency ──────────────────────────────────────────────────────────────

describe('Scheduler — concurrency', () => {
  it('sequential chain respects dependency order', async () => {
    const { plan, state, store, bus, token } = await setupRun('02-plan-code-verify.yaml');
    const executionOrder: string[] = [];
    const worker = new MockWorker({
      delayMs: 10,
      onExecute: (id) => executionOrder.push(id),
    });
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);

    await scheduler.run();

    expect(executionOrder).toEqual(['pipeline.0', 'pipeline.1', 'pipeline.2']);
  });
});

// ─── samples smoke test ───────────────────────────────────────────────────────

describe('Scheduler — samples smoke', () => {
  const samples = ['01-hello-world.yaml', '02-plan-code-verify.yaml'];

  for (const sample of samples) {
    it(`${sample}: runs without crash`, async () => {
      const { plan, state, store, bus, token } = await setupRun(sample);
      const worker = new MockWorker();
      const scheduler = new Scheduler(plan, state, store, worker, bus, token);

      const result = await scheduler.run();

      expect(result.status).toBe('completed');
    });
  }
});
