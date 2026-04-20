import { readFileSync } from 'fs';
import { describe, it, expect, vi } from 'vitest';
import { PipelineCompiler } from '../../compiler';
import { StateStore } from '../../state/store';
import { EventBus } from '../../events/bus';
import { MemoryEventCollector } from '../../events/subscribers/memory-collector';
import { CancellationToken } from '../../cancel/token';
import { AdapterRegistry } from '../../adapters/registry';
import { MockAdapter } from '../../adapters/mock';
import { Scheduler } from '../../scheduler';
import { RealWorker } from '../index';

async function setup(sampleFile: string, adapterBehavior?: ConstructorParameters<typeof MockAdapter>[0]['behavior']) {
  const compiler = new PipelineCompiler();
  const yaml = readFileSync(`examples/adpl/${sampleFile}`, 'utf-8');
  const result = await compiler.compile(yaml);
  if (!result.ok) throw new Error(`Compile failed: ${result.errors.map((e) => e.message).join(', ')}`);

  const plan = result.plan;
  const store = new StateStore();
  const state = store.create(plan);
  const bus = new EventBus();
  const token = new CancellationToken();
  const collector = new MemoryEventCollector();
  collector.attach(bus);

  const registry = new AdapterRegistry();
  // Determine node types in the plan and register mock adapters
  const types = new Set(Array.from(plan.nodes.values()).map((n) => n.spec.type));
  for (const type of types) {
    registry.register(new MockAdapter({ type, behavior: adapterBehavior }));
  }

  const worker = new RealWorker(registry, bus);

  return { plan, state, store, bus, token, collector, registry, worker };
}

// ─── basic execute ────────────────────────────────────────────────────────────

describe('RealWorker — basic execute', () => {
  it('success adapter → success output', async () => {
    const { plan, state, token, worker } = await setup('01-hello-world.yaml', {
      result: { kind: 'success', data: 'hello' },
    });
    const nodeId = plan.topologicalOrder[0];
    const output = await worker.execute(nodeId, plan, state, token);
    expect(output.status).toBe('success');
    expect(output.data).toBe('hello');
  });

  it('failure adapter → failure output', async () => {
    const { plan, state, token, worker } = await setup('01-hello-world.yaml', {
      result: { kind: 'failure', error: { code: 'test', message: 'boom' } },
    });
    const nodeId = plan.topologicalOrder[0];
    const output = await worker.execute(nodeId, plan, state, token);
    expect(output.status).toBe('failure');
    expect(output.error?.code).toBe('test');
  });

  it('adapter receives correct spec and context fields', async () => {
    const onExecute = vi.fn();
    const { plan, state, token, worker } = await setup('01-hello-world.yaml', { onExecute });
    const nodeId = plan.topologicalOrder[0];
    await worker.execute(nodeId, plan, state, token);
    expect(onExecute).toHaveBeenCalledOnce();
    const [spec, ctx] = onExecute.mock.calls[0];
    expect(spec).toBeDefined();
    expect(ctx.$self).toBeDefined();
    expect(ctx.$now).toBeInstanceOf(Date);
    expect(ctx.$nodes).toBeDefined();
  });

  it('unknown nodeId → failure output (not throw)', async () => {
    const { plan, state, token, worker } = await setup('01-hello-world.yaml');
    const output = await worker.execute('nonexistent.node', plan, state, token);
    expect(output.status).toBe('failure');
    expect(output.error?.code).toBe('node_not_found');
  });

  it('missing adapter: lenient mode → failure', async () => {
    const { plan, state, bus, token } = await setup('01-hello-world.yaml');
    const emptyRegistry = new AdapterRegistry();
    const lenientWorker = new RealWorker(emptyRegistry, bus, { lenientOnMissingAdapter: true });
    const output = await lenientWorker.execute(plan.topologicalOrder[0], plan, state, token);
    expect(output.status).toBe('failure');
    expect(output.error?.code).toBe('adapter_not_registered');
  });

  it('missing adapter: strict mode → throws', async () => {
    const { plan, state, bus, token } = await setup('01-hello-world.yaml');
    const emptyRegistry = new AdapterRegistry();
    const strictWorker = new RealWorker(emptyRegistry, bus);
    await expect(strictWorker.execute(plan.topologicalOrder[0], plan, state, token)).rejects.toThrow();
  });
});

// ─── timeout ─────────────────────────────────────────────────────────────────

describe('RealWorker — timeout', () => {
  it('slow adapter with short spec.timeout → failure with timeout category', async () => {
    const { plan, state, token, registry, bus } = await setup('01-hello-world.yaml');

    // Re-register adapter with a delay longer than timeout
    registry.register(
      new MockAdapter({
        type: 'shell',
        behavior: { delayMs: 500, result: { kind: 'success' } },
      }),
    );

    // Patch node spec timeout to 0.02 seconds (20ms)
    const node = plan.nodes.get(plan.topologicalOrder[0])!;
    (node.spec as any).timeout = 0.02;

    const worker = new RealWorker(registry, bus);
    const output = await worker.execute(node.pathId, plan, state, token);
    expect(output.status).toBe('failure');
    expect(output.error?.category).toBe('timeout');
  });
});

// ─── retry ───────────────────────────────────────────────────────────────────

describe('RealWorker — retry', () => {
  it('retries transient failure, succeeds on 3rd attempt', async () => {
    const { plan, state, bus, token } = await setup('01-hello-world.yaml');
    const registry = new AdapterRegistry();
    let callCount = 0;
    registry.register(
      new MockAdapter({
        type: 'shell',
        behavior: {
          executeCallback: async () => {
            callCount++;
            if (callCount < 3) {
              return {
                status: 'failure' as const,
                error: { code: 'network', message: 'transient', category: 'transient' as const },
              };
            }
            return { status: 'success' as const, data: 'done' };
          },
        },
      }),
    );

    const node = plan.nodes.get(plan.topologicalOrder[0])!;
    // maxAttempts=3 with fast backoff
    (node.spec as any).retryPolicy = { maxAttempts: 3, backoff: 'fixed', initialDelay: 0.01 };

    const worker = new RealWorker(registry, bus);
    const output = await worker.execute(node.pathId, plan, state, token);
    expect(output.status).toBe('success');
    expect(callCount).toBe(3);
  });

  it('does not retry persistent failure', async () => {
    const { plan, state, bus, token } = await setup('01-hello-world.yaml');
    const registry = new AdapterRegistry();
    let callCount = 0;
    registry.register(
      new MockAdapter({
        type: 'shell',
        behavior: {
          executeCallback: async () => {
            callCount++;
            return {
              status: 'failure' as const,
              error: { code: 'bad', message: 'persistent', category: 'persistent' as const },
            };
          },
        },
      }),
    );

    const node = plan.nodes.get(plan.topologicalOrder[0])!;
    (node.spec as any).retryPolicy = { maxAttempts: 5, backoff: 'fixed', initialDelay: 0.01 };

    const worker = new RealWorker(registry, bus);
    const output = await worker.execute(node.pathId, plan, state, token);
    expect(output.status).toBe('failure');
    expect(callCount).toBe(1);
  });

  it('emits node.retry event on each retry', async () => {
    const { plan, state, bus, token, collector } = await setup('01-hello-world.yaml');
    const registry = new AdapterRegistry();
    let callCount = 0;
    registry.register(
      new MockAdapter({
        type: 'shell',
        behavior: {
          executeCallback: async () => {
            callCount++;
            if (callCount < 3) {
              return {
                status: 'failure' as const,
                error: { code: 'net', message: 'fail', category: 'transient' as const },
              };
            }
            return { status: 'success' as const };
          },
        },
      }),
    );

    const node = plan.nodes.get(plan.topologicalOrder[0])!;
    (node.spec as any).retryPolicy = { maxAttempts: 3, backoff: 'fixed', initialDelay: 0.01 };

    const worker = new RealWorker(registry, bus);
    await worker.execute(node.pathId, plan, state, token);

    const retryEvents = collector.ofType('node.retry');
    expect(retryEvents).toHaveLength(2);
    expect(retryEvents[0].attempt).toBe(2);
    expect(retryEvents[1].attempt).toBe(3);
  });

  it('cancellation during backoff sleep: returns cancelled output', async () => {
    const { plan, state, bus } = await setup('01-hello-world.yaml');
    const registry = new AdapterRegistry();
    registry.register(
      new MockAdapter({
        type: 'shell',
        behavior: {
          executeCallback: async () => ({
            status: 'failure' as const,
            error: { code: 'net', message: 'fail', category: 'transient' as const },
          }),
        },
      }),
    );

    const node = plan.nodes.get(plan.topologicalOrder[0])!;
    // Long backoff so cancel fires during sleep
    (node.spec as any).retryPolicy = { maxAttempts: 5, backoff: 'fixed', initialDelay: 5 };

    const token = new CancellationToken();
    setTimeout(() => token.cancel('user stop'), 30);

    const worker = new RealWorker(registry, bus);
    const output = await worker.execute(node.pathId, plan, state, token);
    expect(output.status).toBe('cancelled');
  });
});

// ─── cancellation ─────────────────────────────────────────────────────────────

describe('RealWorker — cancellation', () => {
  it('pre-cancelled token: returns cancelled without calling adapter', async () => {
    const onExecute = vi.fn();
    const { plan, state, bus, token, worker } = await setup('01-hello-world.yaml', { onExecute });
    token.cancel('pre-cancel');
    const output = await worker.execute(plan.topologicalOrder[0], plan, state, token);
    expect(output.status).toBe('cancelled');
    expect(onExecute).not.toHaveBeenCalled();
  });
});

// ─── integration: Scheduler + RealWorker ─────────────────────────────────────

describe('Scheduler + RealWorker integration', () => {
  it('01-hello-world: end-to-end success', async () => {
    const { plan, state, store, bus, token, worker } = await setup('01-hello-world.yaml', {
      result: { kind: 'success', data: 'greet' },
    });
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);
    const result = await scheduler.run();
    expect(result.status).toBe('completed');
    expect(result.completedNodes).toBe(1);
  });

  it('02-plan-code-verify: 3 sequential nodes, each gets $prev output', async () => {
    const onExecute = vi.fn();
    const { plan, state, store, bus, token, worker } = await setup('02-plan-code-verify.yaml', {
      result: { kind: 'success', data: 'step-result' },
      onExecute,
    });
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);
    const result = await scheduler.run();
    expect(result.status).toBe('completed');
    expect(result.completedNodes).toBe(3);

    // Second and third nodes should have $prev set
    expect(onExecute).toHaveBeenCalledTimes(3);
    const [, ctx1] = onExecute.mock.calls[1]; // code node: (spec, context)
    const [, ctx2] = onExecute.mock.calls[2]; // verify node
    expect(ctx1.$prev).toBeDefined();
    expect(ctx2.$prev).toBeDefined();
  });
});
