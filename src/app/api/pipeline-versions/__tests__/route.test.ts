import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { pipelineVersions, projects } from '@/lib/db/schema';
import { POST } from '../route';

const PROJECT_ID = 'api-pv-proj';

const VALID_YAML =
  'adplVersion: 1\nname: hello-world\npipeline:\n  - id: greet\n    type: shell\n    command: echo hello\n';

function seedProject() {
  db.insert(projects)
    .values({
      id: PROJECT_ID,
      name: PROJECT_ID,
      path: '/tmp/api-pv',
      description: null,
      icon: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();
}

describe('POST /api/pipeline-versions', () => {
  beforeEach(() => {
    db.delete(pipelineVersions).run();
    seedProject();
  });

  it('valid body → 200 + versionNumber=1', async () => {
    const req = new Request('http://x/api/pipeline-versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_ID, yaml: VALID_YAML }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string; versionNumber: number } };
    expect(body.data.versionNumber).toBe(1);
    expect(body.data.id).toBeTruthy();
  });

  it('invalid yaml syntax → 400 YAML_VALIDATION_FAILED', async () => {
    const req = new Request('http://x/api/pipeline-versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_ID, yaml: 'key: [unclosed' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('YAML_VALIDATION_FAILED');
  });

  it('missing yaml field → 400 INVALID_BODY', async () => {
    const req = new Request('http://x/api/pipeline-versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_ID }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_BODY');
  });

  it('malformed JSON body → 400 INVALID_BODY', async () => {
    const req = new Request('http://x/api/pipeline-versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-valid-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_BODY');
  });

  it('non-existent projectId → 404 PROJECT_NOT_FOUND', async () => {
    const req = new Request('http://x/api/pipeline-versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'does-not-exist', yaml: VALID_YAML }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('PROJECT_NOT_FOUND');
  });

  it('body is null → 400 INVALID_BODY', async () => {
    const req = new Request('http://x/api/pipeline-versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_BODY');
  });

  it('body is array → 400 INVALID_BODY', async () => {
    const req = new Request('http://x/api/pipeline-versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[]',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_BODY');
  });

  it('body is string → 400 INVALID_BODY', async () => {
    const req = new Request('http://x/api/pipeline-versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '"hello"',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_BODY');
  });
});
