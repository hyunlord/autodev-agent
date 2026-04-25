import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import {
  pipelineRuns,
  pipelineRunState,
  pipelineEvents,
  pipelineVersions,
  projects,
} from '@/lib/db/schema';
import { GET as getList } from '../route';
import { GET as getSingle } from '../[runId]/route';
import { GET as getState } from '../[runId]/state/route';
import { GET as getEvents } from '../[runId]/events/route';

const PROJECT_ID = 'rt-proj';
const VERSION_ID = 'rt-ver';

function seedFK() {
  db.insert(projects).values({
    id: PROJECT_ID,
    name: 'rt',
    path: '/tmp/rt',
    description: null,
    icon: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).onConflictDoNothing().run();
  db.insert(pipelineVersions).values({
    id: VERSION_ID,
    projectId: PROJECT_ID,
    versionNumber: 1,
    pipelineYaml: 'adplVersion: 1\nname: rt\n',
    adplVersion: '1.0',
    changeSource: 'manual',
    changeDescription: null,
    changedBy: null,
    createdAt: new Date().toISOString(),
  }).onConflictDoNothing().run();
}

function seedRun(id: string, taskId: string, startedAt: string) {
  db.insert(pipelineRuns).values({
    id, taskId,
    projectId: PROJECT_ID, pipelineVersionId: VERSION_ID,
    status: 'running', startedAt,
  }).run();
}

describe('/api/pipeline-runs/* routes', () => {
  beforeEach(() => {
    db.delete(pipelineEvents).run();
    db.delete(pipelineRunState).run();
    db.delete(pipelineRuns).run();
    seedFK();
  });

  it('GET /api/pipeline-runs/[runId] → 200 + data', async () => {
    seedRun('r-200', 't-1', new Date().toISOString());
    const res = await getSingle(new Request('http://x/api/pipeline-runs/r-200'), {
      params: Promise.resolve({ runId: 'r-200' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe('r-200');
  });

  it('GET /api/pipeline-runs/[absent] → 404', async () => {
    const res = await getSingle(new Request('http://x/api/pipeline-runs/missing'), {
      params: Promise.resolve({ runId: 'missing' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('PIPELINE_RUN_NOT_FOUND');
  });

  it('GET /api/pipeline-runs?taskId=... → list scoped by task', async () => {
    seedRun('a', 't-list', '2026-04-25T00:00:00.000Z');
    seedRun('b', 't-list', '2026-04-25T01:00:00.000Z');
    seedRun('c', 't-other', '2026-04-25T02:00:00.000Z');
    const res = await getList(new Request('http://x/api/pipeline-runs?taskId=t-list'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data.map((r: { id: string }) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('GET /api/pipeline-runs (no params) → 400', async () => {
    const res = await getList(new Request('http://x/api/pipeline-runs'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('INVALID_QUERY');
  });

  it('GET /api/pipeline-runs/[runId]/state → parsed state', async () => {
    db.insert(pipelineRunState).values({
      runId: 'r-state',
      stateJson: JSON.stringify({ status: 'running', nodes: { a: 'pending' } }),
      version: 3,
      updatedAt: '2026-04-25T00:00:00.000Z',
    }).run();
    const res = await getState(new Request('http://x/api/pipeline-runs/r-state/state'), {
      params: Promise.resolve({ runId: 'r-state' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.runId).toBe('r-state');
    expect(body.data.state).toEqual({ status: 'running', nodes: { a: 'pending' } });
    expect(body.data.version).toBe(3);
  });

  it('GET /api/pipeline-runs/[runId]/events → events list with type filter', async () => {
    db.insert(pipelineEvents).values([
      { id: 'e1', runId: 'r-ev', type: 'node.ready',     payloadJson: '{}', createdAt: '2026-04-25T00:00:00.000Z' },
      { id: 'e2', runId: 'r-ev', type: 'node.completed', payloadJson: '{}', createdAt: '2026-04-25T00:01:00.000Z' },
    ]).run();
    const res = await getEvents(
      new Request('http://x/api/pipeline-runs/r-ev/events?type=node.completed'),
      { params: Promise.resolve({ runId: 'r-ev' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('e2');
  });

  it('GET events with limit=5000 → cap at 1000 (not enforced as count, but query honored)', async () => {
    // Seed 3 events to verify limit doesn't trim valid rows
    db.insert(pipelineEvents).values([
      { id: 'x1', runId: 'r-cap', type: 'a', payloadJson: '{}', createdAt: '2026-04-25T00:00:00.000Z' },
      { id: 'x2', runId: 'r-cap', type: 'a', payloadJson: '{}', createdAt: '2026-04-25T00:00:01.000Z' },
      { id: 'x3', runId: 'r-cap', type: 'a', payloadJson: '{}', createdAt: '2026-04-25T00:00:02.000Z' },
    ]).run();
    const res = await getEvents(
      new Request('http://x/api/pipeline-runs/r-cap/events?limit=5000'),
      { params: Promise.resolve({ runId: 'r-cap' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeLessThanOrEqual(1000);
    expect(body.data.length).toBe(3);
  });
});
