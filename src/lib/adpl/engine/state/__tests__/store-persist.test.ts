import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { pipelineRunState } from '@/lib/db/schema';
import { PipelineCompiler } from '../../compiler/index';
import type { ExecutionPlan } from '../../compiler/types';
import { StateStore } from '../store';

function yamlFromFile(name: string): string {
  return readFileSync(join(process.cwd(), `examples/adpl/${name}.yaml`), 'utf-8');
}

async function compilePlan(name: string): Promise<ExecutionPlan> {
  const compiler = new PipelineCompiler();
  const result = await compiler.compile(yamlFromFile(name));
  if (!result.ok) {
    throw new Error(`compile failed: ${result.errors.map((e) => e.message).join(', ')}`);
  }
  return result.plan;
}

describe('StateStore.persist / StateStore.restore (DB-backed)', () => {
  beforeEach(() => {
    // 각 테스트 전에 pipeline_run_state 테이블 비우기 — 다른 테스트와 격리
    db.delete(pipelineRunState).run();
  });

  it('persist() 첫 호출 시 row 를 INSERT 하고 version=1 로 기록', async () => {
    const plan = await compilePlan('01-hello-world');
    const store = new StateStore();
    const state = await store.create(plan);

    await store.persist(state.id);

    const row = db
      .select()
      .from(pipelineRunState)
      .where(eq(pipelineRunState.runId, state.id))
      .get();

    expect(row).toBeDefined();
    expect(row!.runId).toBe(state.id);
    expect(row!.version).toBe(1);
    expect(row!.stateJson).toContain(state.executionPlanId);
    expect(row!.updatedAt).toBeTruthy();
  });

  it('persist() 두 번째 호출 시 row 를 UPDATE 하고 version 이 2 로 증가', async () => {
    const plan = await compilePlan('01-hello-world');
    const store = new StateStore();
    const state = await store.create(plan);

    await store.persist(state.id);
    const afterFirst = db
      .select()
      .from(pipelineRunState)
      .where(eq(pipelineRunState.runId, state.id))
      .get();
    expect(afterFirst!.version).toBe(1);

    // 상태 변경 후 두 번째 persist
    await store.updatePipeline(state.id, 'running');
    await store.persist(state.id);

    const afterSecond = db
      .select()
      .from(pipelineRunState)
      .where(eq(pipelineRunState.runId, state.id))
      .get();

    expect(afterSecond!.version).toBe(2);
    expect(afterSecond!.stateJson).toContain('"status":"running"');

    // 총 행 개수는 여전히 1 (UPDATE, not INSERT)
    const rows = db.select().from(pipelineRunState).all();
    expect(rows).toHaveLength(1);
  });

  it('restore(runId) 는 DB 에서 전체 PipelineRunState 를 재구성', async () => {
    const plan = await compilePlan('02-plan-code-verify');
    const store = new StateStore();
    const state = await store.create(plan);

    // 일부 상태 변경
    const nodeIds = Array.from(plan.nodes.keys());
    await store.updateNode(state.id, nodeIds[0], () => ({ status: 'ready' }));
    await store.updateNode(state.id, nodeIds[0], () => ({
      status: 'running',
      startedAt: new Date(),
      attemptNumber: 1,
    }));
    await store.updateNode(state.id, nodeIds[0], () => ({
      status: 'success',
      completedAt: new Date(),
      output: { status: 'success', data: 'foo' },
    }));
    await store.incrementMetrics(state.id, { costUsd: 0.05, tokensIn: 100, tokensOut: 50 });
    await store.updatePipeline(state.id, 'running');

    await store.persist(state.id);

    // 새 StateStore 인스턴스로 복원
    const restored = await StateStore.restore(state.id);
    const restoredState = await restored.get(state.id);

    expect(restoredState).not.toBeNull();
    expect(restoredState!.id).toBe(state.id);
    expect(restoredState!.executionPlanId).toBe(state.executionPlanId);
    expect(restoredState!.status).toBe('running');
    expect(restoredState!.totalCostUsd).toBeCloseTo(0.05);
    expect(restoredState!.totalTokensIn).toBe(100);
    expect(restoredState!.totalTokensOut).toBe(50);
    expect(restoredState!.nodes.size).toBe(plan.nodes.size);

    const node0 = restoredState!.nodes.get(nodeIds[0])!;
    expect(node0.status).toBe('success');
    expect(node0.attemptNumber).toBe(1);
    expect(node0.startedAt).toBeInstanceOf(Date);
    expect(node0.completedAt).toBeInstanceOf(Date);
    expect(node0.output).toEqual({ status: 'success', data: 'foo' });
  });

  it('동일 runId 로 두 StateStore 인스턴스가 persist 시 두 번째는 STATE_CONFLICT', async () => {
    const plan = await compilePlan('01-hello-world');

    // storeA: 생성 + persist (version=1)
    const storeA = new StateStore();
    const state = await storeA.create(plan);
    await storeA.persist(state.id);

    // storeB: 동일 runId 로 restore → version=1 에서 출발
    const storeB = await StateStore.restore(state.id);

    // storeA 에서 update 후 다시 persist → DB version 이 2 로 진행
    await storeA.updatePipeline(state.id, 'running');
    await storeA.persist(state.id);

    // storeB 가 이제 persist 시도 — 여전히 version=1 을 기대하므로 충돌
    await expect(storeB.persist(state.id)).rejects.toThrow(
      new RegExp(`STATE_CONFLICT: ${state.id}`),
    );
  });

  it('restore(nonexistentId) 는 RUN_STATE_NOT_FOUND 에러 throw', async () => {
    await expect(StateStore.restore('does-not-exist-xyz')).rejects.toThrow(
      /RUN_STATE_NOT_FOUND: does-not-exist-xyz/,
    );
  });

  it('Map round-trip: nodes / flowStates / branchResults 가 serialize → persist → restore 후 Map 으로 유지', async () => {
    // 03-parallel-checks 는 parallel flow + branchResults Map 사용
    const plan = await compilePlan('03-parallel-checks');
    const store = new StateStore();
    const state = await store.create(plan);

    // 초기 상태 검증 — Map 여부
    expect(state.nodes).toBeInstanceOf(Map);
    expect(state.flowStates).toBeInstanceOf(Map);

    const parallelFlow = Array.from(state.flowStates.values()).find((f) => f.type === 'parallel');
    expect(parallelFlow).toBeDefined();
    expect(parallelFlow!.branchResults).toBeInstanceOf(Map);
    const initialBranchKeys = Array.from(parallelFlow!.branchResults!.keys());
    expect(initialBranchKeys.length).toBeGreaterThan(0);

    // 한 branch 를 running 으로 업데이트 후 persist
    await store.updateFlow(state.id, parallelFlow!.flowNodeId, (c) => {
      const next = new Map(c.branchResults!);
      next.set(initialBranchKeys[0], 'running');
      return { branchResults: next };
    });

    await store.persist(state.id);

    // restore → Map 형태 확인
    const restored = await StateStore.restore(state.id);
    const rstate = (await restored.get(state.id))!;

    expect(rstate.nodes).toBeInstanceOf(Map);
    expect(rstate.flowStates).toBeInstanceOf(Map);
    expect(rstate.nodes.size).toBe(state.nodes.size);
    expect(rstate.flowStates.size).toBe(state.flowStates.size);

    const rflow = rstate.flowStates.get(parallelFlow!.flowNodeId)!;
    expect(rflow.type).toBe('parallel');
    expect(rflow.branchResults).toBeInstanceOf(Map);
    expect(rflow.branchResults!.size).toBe(parallelFlow!.branchResults!.size);
    // 업데이트한 branch 가 running 으로 유지
    expect(rflow.branchResults!.get(initialBranchKeys[0])).toBe('running');
    // 나머지는 pending 유지
    for (let i = 1; i < initialBranchKeys.length; i++) {
      expect(rflow.branchResults!.get(initialBranchKeys[i])).toBe('pending');
    }
  });
});
