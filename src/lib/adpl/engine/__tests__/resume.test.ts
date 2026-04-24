import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { pipelineRunState } from '@/lib/db/schema';
import { PipelineExecutor } from '../executor';
import { PipelineCompiler } from '../compiler';
import { StateStore } from '../state/store';
import { EventBus } from '../events/bus';
import { AdapterRegistry } from '../adapters/registry';
import { MockAdapter } from '../adapters/mock';

function readYaml(name: string): string {
  return readFileSync(`examples/adpl/${name}`, 'utf-8');
}

const TRIGGER = {
  triggerId: 'tr1',
  type: 'task_created',
  firedAt: '2026-04-24T00:00:00.000Z',
};

const ALL_TYPES = [
  'agent', 'shell', 'http', 'webhook_out',
  'branch', 'parallel', 'loop', 'gate',
  'mcp', 'set', 'transform',
];

function makeRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  for (const t of ALL_TYPES) {
    registry.register(new MockAdapter({ type: t }));
  }
  return registry;
}

function makeExecutor(store?: StateStore): PipelineExecutor {
  return new PipelineExecutor(
    new PipelineCompiler(),
    makeRegistry(),
    store ?? new StateStore(),
    new EventBus(),
  );
}

describe('PipelineExecutor.resumeRun — Stage 6 F3', () => {
  beforeEach(() => {
    // 각 테스트 격리: pipeline_run_state 비우기
    db.delete(pipelineRunState).run();
  });

  // ────────────────────────────────────────────────
  it('1. 정상 실행 후 resume: store.triggerContext 복원됨', async () => {
    const runInput = {
      pipelineYaml: readYaml('01-hello-world.yaml'),
      projectId: 'p1',
      pipelineVersionId: 'v-01',
      taskId: 't-01',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/test-worktree-resume-1',
    };

    const executor = makeExecutor();
    const result = await executor.run(runInput, { worker: { triggerContext: TRIGGER } });
    expect(result.status).toBe('completed');

    // DB 에 persist 됨 (최소 1 노드 완료로 F2 persist 발동)
    const row = db.select().from(pipelineRunState).where(eq(pipelineRunState.runId, result.runId)).get();
    expect(row).toBeDefined();

    // Restore → triggerContext 복원 확인
    const restored = await StateStore.restore(result.runId);
    const state = await restored.get(result.runId);
    expect(state).not.toBeNull();
    expect(state!.triggerContext).toEqual(TRIGGER);
    expect(state!.taskId).toBe('t-01');
    expect(state!.pipelineVersionId).toBe('v-01');
    expect(state!.worktreeRoot).toBe('/tmp/test-worktree-resume-1');
  });

  // ────────────────────────────────────────────────
  it('2. resumeRun(nonexistent runId) → RESUME_STATE_MISSING', async () => {
    const executor = makeExecutor();
    await expect(
      executor.resumeRun({ runId: 'does-not-exist', pipelineYaml: readYaml('01-hello-world.yaml') }),
    ).rejects.toThrow(/RESUME_STATE_MISSING/);
  });

  // ────────────────────────────────────────────────
  it('3. running 상태 노드 → resumeRun 시 ORPHANED_ON_RESUME 실패로 마킹', async () => {
    // 직접 state 생성 후 running 으로 설정 + persist
    const compiler = new PipelineCompiler();
    const compileRes = await compiler.compile(readYaml('02-plan-code-verify.yaml'));
    if (!compileRes.ok) throw new Error('compile failed');
    const plan = compileRes.plan;

    const store = new StateStore();
    const state = await store.create(plan);
    await store.setResumeContext(state.id, {
      triggerContext: TRIGGER,
      taskId: 't-03',
      pipelineVersionId: 'v-03',
      projectId: 'p1',
      worktreeRoot: '/tmp/test-worktree-resume-3',
    });

    // 첫 번째 노드를 running 으로 만듦 (orphaned simulation)
    const nodeIds = plan.topologicalOrder;
    await store.updateNode(state.id, nodeIds[0], () => ({ status: 'ready' }));
    await store.updateNode(state.id, nodeIds[0], () => ({
      status: 'running',
      startedAt: new Date(),
      attemptNumber: 1,
    }));
    await store.persist(state.id);

    // Restore + resumeRun
    const restored = await StateStore.restore(state.id);
    const executor = makeExecutor(restored);

    // resumeRun 은 orphan 을 failure 로 마킹 → abort 정책상 후속 노드는 pending/skipped
    // 결과는 failed (failed > 0)
    const result = await executor.resumeRun({
      runId: state.id,
      pipelineYaml: readYaml('02-plan-code-verify.yaml'),
    });
    expect(result.status).toBe('failed');

    // 첫 노드는 failure + ORPHANED_ON_RESUME
    const finalState = await executor.getState(state.id);
    const firstNode = finalState!.nodes.get(nodeIds[0])!;
    expect(firstNode.status).toBe('failure');
    expect(firstNode.error?.code).toBe('ORPHANED_ON_RESUME');
  });

  // ────────────────────────────────────────────────
  it('4. triggerContext 없는 state → RESUME_MISSING_TRIGGER', async () => {
    const compiler = new PipelineCompiler();
    const compileRes = await compiler.compile(readYaml('01-hello-world.yaml'));
    if (!compileRes.ok) throw new Error('compile failed');

    const store = new StateStore();
    const state = await store.create(compileRes.plan);
    // triggerContext 세팅 안 함
    await store.persist(state.id);

    const restored = await StateStore.restore(state.id);
    const executor = makeExecutor(restored);

    await expect(
      executor.resumeRun({ runId: state.id, pipelineYaml: readYaml('01-hello-world.yaml') }),
    ).rejects.toThrow(/RESUME_MISSING_TRIGGER/);
  });

  // ────────────────────────────────────────────────
  it('5. worktreeRoot 없는 state → RESUME_MISSING_WORKTREE_ROOT', async () => {
    const compiler = new PipelineCompiler();
    const compileRes = await compiler.compile(readYaml('01-hello-world.yaml'));
    if (!compileRes.ok) throw new Error('compile failed');

    const store = new StateStore();
    const state = await store.create(compileRes.plan);
    await store.setResumeContext(state.id, { triggerContext: TRIGGER });  // worktreeRoot 미설정
    await store.persist(state.id);

    const restored = await StateStore.restore(state.id);
    const executor = makeExecutor(restored);

    await expect(
      executor.resumeRun({ runId: state.id, pipelineYaml: readYaml('01-hello-world.yaml') }),
    ).rejects.toThrow(/RESUME_MISSING_WORKTREE_ROOT/);
  });

  // ────────────────────────────────────────────────
  it('6. resume 시 완료 노드 보존 + pending 노드만 실행 (sequential 3 노드)', async () => {
    const compiler = new PipelineCompiler();
    const compileRes = await compiler.compile(readYaml('02-plan-code-verify.yaml'));
    if (!compileRes.ok) throw new Error('compile failed');
    const plan = compileRes.plan;

    const store = new StateStore();
    const state = await store.create(plan);
    await store.setResumeContext(state.id, {
      triggerContext: TRIGGER,
      taskId: 't-06',
      pipelineVersionId: 'v-06',
      projectId: 'p1',
      worktreeRoot: '/tmp/test-worktree-resume-6',
    });

    // 첫 번째 노드를 직접 success 로 마킹 (이미 완료된 것처럼)
    const nodeIds = plan.topologicalOrder;
    await store.updateNode(state.id, nodeIds[0], () => ({ status: 'ready' }));
    await store.updateNode(state.id, nodeIds[0], () => ({
      status: 'running',
      startedAt: new Date(),
      attemptNumber: 1,
    }));
    await store.updateNode(state.id, nodeIds[0], () => ({
      status: 'success',
      completedAt: new Date(),
      output: { status: 'success', data: 'preserved-node1' },
    }));
    await store.persist(state.id);

    // Restore + resumeRun
    const restored = await StateStore.restore(state.id);
    const executor = makeExecutor(restored);
    const result = await executor.resumeRun({
      runId: state.id,
      pipelineYaml: readYaml('02-plan-code-verify.yaml'),
    });

    expect(result.status).toBe('completed');
    expect(result.completedNodes).toBe(3);

    const finalState = await executor.getState(state.id);
    // 노드 1 은 원래 output 그대로 보존
    expect(finalState!.nodes.get(nodeIds[0])!.status).toBe('success');
    expect(finalState!.nodes.get(nodeIds[0])!.output!.data).toBe('preserved-node1');
    // 노드 2, 3 은 MockAdapter 로 새로 success
    expect(finalState!.nodes.get(nodeIds[1])!.status).toBe('success');
    expect(finalState!.nodes.get(nodeIds[2])!.status).toBe('success');
  });

  // ────────────────────────────────────────────────
  it('7. triggerContext + resume metadata 직렬화 round-trip (state 필드 모두 복원)', async () => {
    const compiler = new PipelineCompiler();
    const compileRes = await compiler.compile(readYaml('01-hello-world.yaml'));
    if (!compileRes.ok) throw new Error('compile failed');

    const store = new StateStore();
    const state = await store.create(compileRes.plan);

    const customTrigger = {
      triggerId: 'tr-custom',
      type: 'webhook_in',
      firedAt: '2026-04-24T01:02:03.456Z',
      payload: { foo: 'bar' },
    };

    await store.setResumeContext(state.id, {
      triggerContext: customTrigger,
      taskId: 't-07',
      pipelineVersionId: 'v-07',
      projectId: 'p-07',
      worktreeRoot: '/tmp/wt-07',
    });
    await store.persist(state.id);

    const restored = await StateStore.restore(state.id);
    const rstate = await restored.get(state.id);

    expect(rstate!.triggerContext).toEqual(customTrigger);
    expect(rstate!.taskId).toBe('t-07');
    expect(rstate!.pipelineVersionId).toBe('v-07');
    expect(rstate!.projectId).toBe('p-07');
    expect(rstate!.worktreeRoot).toBe('/tmp/wt-07');
  });
});
