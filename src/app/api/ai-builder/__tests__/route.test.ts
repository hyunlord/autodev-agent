import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { projects } from '@/lib/db/schema';
import { POST } from '../route';
import type { AIBuilderResult } from '@/lib/ai-builder/types';

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));

vi.mock('@/lib/ai-builder/orchestrator', () => ({
  AIBuilderOrchestrator: vi.fn().mockImplementation(function (this: { run: typeof mockRun }) {
    this.run = mockRun;
  }),
}));

const PROJECT_ID = 'api-ab-proj';

function seedProject() {
  db.insert(projects)
    .values({
      id: PROJECT_ID,
      name: PROJECT_ID,
      path: '/tmp/api-ab',
      description: null,
      icon: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();
}

function makeResult(overrides: Partial<AIBuilderResult> = {}): AIBuilderResult {
  return {
    intent: 'new',
    needsClarification: false,
    explanation: 'Generated a pipeline.',
    warnings: [],
    attempts: 1,
    steps: ['classify_intent', 'assemble_context', 'call_llm', 'parse_response', 'validate'],
    generatedYaml: 'adplVersion: 1\nname: test\npipeline: []\n',
    ...overrides,
  };
}

function post(body: unknown) {
  return POST(
    new Request('http://x/api/ai-builder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/ai-builder', () => {
  beforeEach(() => {
    mockRun.mockReset();
    seedProject();
  });

  it('valid request → 200 + AIBuilderResult', async () => {
    mockRun.mockResolvedValueOnce(makeResult());
    const res = await post({ projectId: PROJECT_ID, userMessage: 'create daily build pipeline' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: AIBuilderResult };
    expect(body.data.intent).toBe('new');
    expect(body.data.generatedYaml).toBeTruthy();
    expect(mockRun).toHaveBeenCalledOnce();
  });

  it('passes currentYaml + conversationHistory to orchestrator', async () => {
    mockRun.mockResolvedValueOnce(makeResult({ intent: 'modify' }));
    await post({
      projectId: PROJECT_ID,
      userMessage: 'add a lint step',
      currentYaml: 'adplVersion: 1\nname: t\npipeline: []\n',
      conversationHistory: [{ role: 'user', content: 'previous turn' }],
    });
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        currentYaml: expect.any(String),
        conversationHistory: expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
      }),
    );
  });

  it('malformed JSON → 400 INVALID_BODY', async () => {
    const res = await POST(
      new Request('http://x/api/ai-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-valid-json',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('INVALID_BODY');
  });

  it('body is null → 400 INVALID_BODY', async () => {
    const res = await POST(
      new Request('http://x/api/ai-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('INVALID_BODY');
  });

  it('body is array → 400 INVALID_BODY', async () => {
    const res = await POST(
      new Request('http://x/api/ai-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '[]',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('INVALID_BODY');
  });

  it('missing userMessage → 400 INVALID_BODY', async () => {
    const res = await post({ projectId: PROJECT_ID });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('INVALID_BODY');
  });

  it('missing projectId → 400 INVALID_BODY', async () => {
    const res = await post({ userMessage: 'create pipeline' });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('INVALID_BODY');
  });

  it('unknown projectId → 404 PROJECT_NOT_FOUND', async () => {
    const res = await post({ projectId: 'does-not-exist', userMessage: 'create pipeline' });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe('PROJECT_NOT_FOUND');
  });

  it('orchestrator throws → 500 AI_BUILDER_FAILED (no message exposed)', async () => {
    mockRun.mockRejectedValueOnce(new Error('LLM timeout'));
    const res = await post({ projectId: PROJECT_ID, userMessage: 'create pipeline' });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string; message?: string };
    expect(body.error).toBe('AI_BUILDER_FAILED');
    expect(body.message).toBeUndefined();
  });

  it('userMessage too long (4001 chars) → 400 INVALID_BODY', async () => {
    const res = await post({ projectId: PROJECT_ID, userMessage: 'a'.repeat(4001) });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('INVALID_BODY');
  });

  it('currentYaml too long (50001 chars) → 400 INVALID_BODY', async () => {
    const res = await post({ projectId: PROJECT_ID, userMessage: 'modify', currentYaml: 'x'.repeat(50001) });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('INVALID_BODY');
  });

  it('conversationHistory too many turns (11) → 400 INVALID_BODY', async () => {
    const history = Array.from({ length: 11 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'turn' }));
    const res = await post({ projectId: PROJECT_ID, userMessage: 'create pipeline', conversationHistory: history });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('INVALID_BODY');
  });

  it('conversationHistory turn content too long (2001 chars) → 400 INVALID_BODY', async () => {
    const res = await post({
      projectId: PROJECT_ID,
      userMessage: 'create pipeline',
      conversationHistory: [{ role: 'user', content: 'x'.repeat(2001) }],
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('INVALID_BODY');
  });
});
