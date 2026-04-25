import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  pipelineRuns,
  pipelineRunState,
  pipelineEvents,
  pipelineVersions,
  projects,
} from '@/lib/db/schema';
import { PipelineExecutor } from '../executor';
import { PipelineCompiler } from '../compiler';
import { StateStore } from '../state/store';
import { EventBus } from '../events/bus';
import { AdapterRegistry } from '../adapters/registry';
import { MockAdapter } from '../adapters/mock';

const TRIGGER = { triggerId: 'tr-lc', type: 'task_created', firedAt: '2026-04-25T00:00:00.000Z' };
const PROJECT_ID = 'lc-proj';
const VERSION_ID = 'lc-ver';

function readYaml(name: string): string {
  return readFileSync(`examples/adpl/${name}`, 'utf-8');
}

function seedFK() {
  db.insert(projects).values({
    id: PROJECT_ID,
    name: 'lc',
    path: '/tmp/lc',
    description: null,
    icon: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).onConflictDoNothing().run();
  db.insert(pipelineVersions).values({
    id: VERSION_ID,
    projectId: PROJECT_ID,
    versionNumber: 1,
    pipelineYaml: 'adplVersion: 1\nname: lc\n',
    adplVersion: '1.0',
    changeSource: 'manual',
    changeDescription: null,
    changedBy: null,
    createdAt: new Date().toISOString(),
  }).onConflictDoNothing().run();
}

const ALL_TYPES = [
  'agent','shell','http','webhook_out','branch','parallel','loop','gate','mcp','set','transform',
];
function makeExecutor(adapterBehavior?: { failOnType?: string }) {
  const registry = new AdapterRegistry();
  for (const t of ALL_TYPES) {
    if (adapterBehavior?.failOnType === t) {
      registry.register(
        new MockAdapter({ type: t, behavior: { result: { kind: 'failure', error: { code: 'simulated', message: 'forced fail' } } } }),
      );
    } else {
      registry.register(new MockAdapter({ type: t }));
    }
  }
  return new PipelineExecutor(new PipelineCompiler(), registry, new StateStore(), new EventBus());
}

describe('PipelineExecutor — pipeline_runs row lifecycle (Stage 7 G0)', () => {
  beforeEach(() => {
    db.delete(pipelineEvents).run();
    db.delete(pipelineRunState).run();
    db.delete(pipelineRuns).run();
    seedFK();
  });

  it('1. successful run → pipeline_runs row status=completed + nodesCompleted set', async () => {
    const executor = makeExecutor();
    const result = await executor.run({
      pipelineYaml: readYaml('01-hello-world.yaml'),
      projectId: PROJECT_ID,
      pipelineVersionId: VERSION_ID,
      taskId: 't-success',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/lc-wt',
    });

    expect(result.status).toBe('completed');

    const row = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, result.runId)).get();
    expect(row).toBeDefined();
    expect(row!.status).toBe('completed');
    expect(row!.nodesCompleted).toBe(1);
    expect(row!.completedAt).toBeTruthy();
    expect(row!.error).toBeNull();
  });

  it('2. failing run → row status=failed + error JSON populated', async () => {
    // 01-hello-world.yaml has a single shell node — force shell to fail
    const executor = makeExecutor({ failOnType: 'shell' });
    const result = await executor.run({
      pipelineYaml: readYaml('01-hello-world.yaml'),
      projectId: PROJECT_ID,
      pipelineVersionId: VERSION_ID,
      taskId: 't-fail',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/lc-wt',
    });

    // executor.run resolves (Scheduler captures the failure, no throw at top level)
    expect(result.status).toBe('failed');

    const row = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, result.runId)).get();
    expect(row).toBeDefined();
    expect(row!.status).toBe('failed');
    expect(row!.nodesFailed).toBeGreaterThanOrEqual(1);
    expect(row!.completedAt).toBeTruthy();
  });

  it('3. two distinct runs → two distinct rows', async () => {
    const ex1 = makeExecutor();
    const ex2 = makeExecutor();
    const r1 = await ex1.run({
      pipelineYaml: readYaml('01-hello-world.yaml'),
      projectId: PROJECT_ID,
      pipelineVersionId: VERSION_ID,
      taskId: 't-multi',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/lc-wt',
    });
    const r2 = await ex2.run({
      pipelineYaml: readYaml('01-hello-world.yaml'),
      projectId: PROJECT_ID,
      pipelineVersionId: VERSION_ID,
      taskId: 't-multi',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/lc-wt',
    });
    expect(r1.runId).not.toBe(r2.runId);
    const rows = db.select().from(pipelineRuns).where(eq(pipelineRuns.taskId, 't-multi')).all();
    expect(rows).toHaveLength(2);
  });

  it('4. resumeRun reuses row and transitions running→completed (lastResumedAt set)', async () => {
    // First run completes
    const ex1 = makeExecutor();
    const r1 = await ex1.run({
      pipelineYaml: readYaml('01-hello-world.yaml'),
      projectId: PROJECT_ID,
      pipelineVersionId: VERSION_ID,
      taskId: 't-resume',
      triggerContext: TRIGGER,
      worktreeRoot: '/tmp/lc-wt',
    });
    expect(r1.status).toBe('completed');

    const beforeResume = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, r1.runId)).get()!;
    expect(beforeResume.status).toBe('completed');
    expect(beforeResume.lastResumedAt).toBeNull();

    // Now resume — store has the original state still in memory? No, ex2 is a new
    // executor with empty store. Restore first.
    const restored = await StateStore.restore(r1.runId);
    const ex2 = new PipelineExecutor(
      new PipelineCompiler(),
      (() => {
        const reg = new AdapterRegistry();
        for (const t of ALL_TYPES) reg.register(new MockAdapter({ type: t }));
        return reg;
      })(),
      restored,
      new EventBus(),
    );
    const r2 = await ex2.resumeRun({ runId: r1.runId, pipelineYaml: readYaml('01-hello-world.yaml') });
    expect(r2.runId).toBe(r1.runId);

    const afterResume = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, r1.runId)).get()!;
    expect(afterResume.status).toBe('completed'); // resume completed cleanly
    expect(afterResume.lastResumedAt).toBeTruthy();
  });
});
