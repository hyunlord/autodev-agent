import { readFileSync } from 'fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PipelineCompiler } from '../../compiler';
import { StateStore } from '../../state/store';
import { EventBus } from '../../events/bus';
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
  const state = await store.create(plan);
  const bus = new EventBus();
  const token = new CancellationToken();
  return { plan, state, store, bus, token };
}

describe('Scheduler — checkpoint policy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('노드 성공 완료 후 store.persist() 1회 호출', async () => {
    const { plan, state, store, bus, token } = await setupRun('01-hello-world.yaml');
    const persistSpy = vi.spyOn(store, 'persist').mockResolvedValue(undefined);
    const worker = new MockWorker();
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);

    const result = await scheduler.run();

    expect(result.status).toBe('completed');
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy).toHaveBeenCalledWith(state.id);
  });

  it('노드 실패 시에도 store.persist() 1회 호출', async () => {
    const { plan, state, store, bus, token } = await setupRun('01-hello-world.yaml');
    const persistSpy = vi.spyOn(store, 'persist').mockResolvedValue(undefined);
    const worker = new MockWorker({
      defaultResult: {
        status: 'failure',
        error: { code: 'test_error', message: 'simulated failure', category: 'persistent' },
      },
    });
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);

    const result = await scheduler.run();

    expect(result.status).toBe('failed');
    expect(persistSpy).toHaveBeenCalledTimes(1);
  });

  it('persist 실패 → scheduler.run() 이 CHECKPOINT_PERSIST_FAILED 로 reject', async () => {
    const { plan, state, store, bus, token } = await setupRun('01-hello-world.yaml');
    vi.spyOn(store, 'persist').mockRejectedValue(new Error('DB locked'));
    const worker = new MockWorker();
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);

    await expect(scheduler.run()).rejects.toThrow(/CHECKPOINT_PERSIST_FAILED/);
  });

  it('persist 실패 에러에 runId + nodeId + 원인 포함', async () => {
    const { plan, state, store, bus, token } = await setupRun('01-hello-world.yaml');
    vi.spyOn(store, 'persist').mockRejectedValue(new Error('connection reset'));
    const worker = new MockWorker();
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);

    let caught: Error | null = null;
    try {
      await scheduler.run();
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/CHECKPOINT_PERSIST_FAILED/);
    expect(caught!.message).toContain(`runId=${state.id}`);
    expect(caught!.message).toContain('cause=connection reset');
  });

  it('sequential 3-node pipeline → persist 3회 호출', async () => {
    const { plan, state, store, bus, token } = await setupRun('02-plan-code-verify.yaml');
    const persistSpy = vi.spyOn(store, 'persist').mockResolvedValue(undefined);
    const worker = new MockWorker();
    const scheduler = new Scheduler(plan, state, store, worker, bus, token);

    const result = await scheduler.run();

    expect(result.status).toBe('completed');
    expect(result.completedNodes).toBe(3);
    expect(persistSpy).toHaveBeenCalledTimes(3);
  });
});
