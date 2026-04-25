import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import {
  pipelineRuns,
  pipelineRunState,
  pipelineEvents,
  pipelineVersions,
  projects,
} from '@/lib/db/schema';
import {
  getPipelineRun,
  listPipelineRunsByTask,
  listPipelineRunsByProject,
  getPipelineRunState,
  listPipelineEvents,
} from '../pipeline-runs';

const PROJECT_ID = 'q-proj';
const VERSION_ID = 'q-ver';

function seedProjectAndVersion() {
  db.insert(projects).values({
    id: PROJECT_ID,
    name: 'q-proj',
    path: '/tmp/q',
    description: null,
    icon: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).onConflictDoNothing().run();

  db.insert(pipelineVersions).values({
    id: VERSION_ID,
    projectId: PROJECT_ID,
    versionNumber: 1,
    pipelineYaml: 'adplVersion: 1\nname: q\n',
    adplVersion: '1.0',
    changeSource: 'manual',
    changeDescription: null,
    changedBy: null,
    createdAt: new Date().toISOString(),
  }).onConflictDoNothing().run();
}

function seedRun(id: string, taskId: string, startedAt: string) {
  db.insert(pipelineRuns).values({
    id,
    taskId,
    projectId: PROJECT_ID,
    pipelineVersionId: VERSION_ID,
    status: 'running',
    startedAt,
  }).run();
}

describe('queries/pipeline-runs', () => {
  beforeEach(() => {
    db.delete(pipelineEvents).run();
    db.delete(pipelineRunState).run();
    db.delete(pipelineRuns).run();
    seedProjectAndVersion();
  });

  it('getPipelineRun: existing → row, missing → null', () => {
    seedRun('r1', 't1', new Date().toISOString());
    const present = getPipelineRun('r1');
    expect(present).not.toBeNull();
    expect(present!.id).toBe('r1');
    expect(present!.taskId).toBe('t1');

    const missing = getPipelineRun('does-not-exist');
    expect(missing).toBeNull();
  });

  it('listPipelineRunsByTask: ordered by startedAt desc', () => {
    seedRun('r-old', 't-2', '2026-04-20T10:00:00.000Z');
    seedRun('r-new', 't-2', '2026-04-25T10:00:00.000Z');
    seedRun('r-mid', 't-2', '2026-04-22T10:00:00.000Z');

    const rows = listPipelineRunsByTask('t-2');
    expect(rows.map((r) => r.id)).toEqual(['r-new', 'r-mid', 'r-old']);
  });

  it('listPipelineRunsByProject: limit/offset + cap 100', () => {
    for (let i = 0; i < 5; i++) {
      seedRun(`p-${i}`, 't-p', `2026-04-2${i}T00:00:00.000Z`);
    }
    const page1 = listPipelineRunsByProject(PROJECT_ID, { limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);
    const page2 = listPipelineRunsByProject(PROJECT_ID, { limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);
    expect(page1[0].id).not.toBe(page2[0].id);

    // limit cap (100): even when 200 requested, returns at most existing rows
    const huge = listPipelineRunsByProject(PROJECT_ID, { limit: 200 });
    expect(huge.length).toBeLessThanOrEqual(100);
  });

  it('getPipelineRunState: parses stateJson to object', () => {
    db.insert(pipelineRunState).values({
      runId: 'r-state',
      stateJson: JSON.stringify({ status: 'running', nodes: { a: 'pending' } }),
      version: 7,
      updatedAt: '2026-04-25T00:00:00.000Z',
    }).run();

    const view = getPipelineRunState('r-state');
    expect(view).not.toBeNull();
    expect(view!.runId).toBe('r-state');
    expect(view!.version).toBe(7);
    expect(view!.state).toEqual({ status: 'running', nodes: { a: 'pending' } });

    expect(getPipelineRunState('absent')).toBeNull();
  });

  it('listPipelineEvents: type filter + since timestamp filter + limit cap 1000', () => {
    const now = '2026-04-25T10:00:00.000Z';
    const before = '2026-04-25T09:00:00.000Z';
    const after = '2026-04-25T11:00:00.000Z';

    db.insert(pipelineEvents).values([
      { id: 'e1', runId: 'r-ev', type: 'node.ready',     payloadJson: '{}', createdAt: before },
      { id: 'e2', runId: 'r-ev', type: 'node.completed', payloadJson: '{}', createdAt: now },
      { id: 'e3', runId: 'r-ev', type: 'node.completed', payloadJson: '{}', createdAt: after },
      { id: 'e4', runId: 'r-other', type: 'node.completed', payloadJson: '{}', createdAt: now },
    ]).run();

    // run scope only
    const runScope = listPipelineEvents('r-ev');
    expect(runScope.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3']);

    // type filter
    const completedOnly = listPipelineEvents('r-ev', { type: 'node.completed' });
    expect(completedOnly.map((e) => e.id).sort()).toEqual(['e2', 'e3']);

    // since filter (exclusive)
    const sinceNow = listPipelineEvents('r-ev', { since: now });
    expect(sinceNow.map((e) => e.id)).toEqual(['e3']);

    // limit cap (request 5000 → max 1000, but only 3 available)
    const huge = listPipelineEvents('r-ev', { limit: 5000 });
    expect(huge.length).toBeLessThanOrEqual(1000);
    expect(huge.length).toBe(3);
  });
});
