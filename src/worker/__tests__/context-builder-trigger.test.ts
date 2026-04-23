import { describe, it, expect } from 'vitest';
import { buildTriggerContext } from '../context-builder';

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-abc',
    prompt: 'test prompt',
    status: 'pending' as const,
    planningMode: 'claude-cli' as const,
    agentId: 'claude-code',
    projectDir: null,
    projectType: null,
    plan: null,
    systemPrompt: null,
    planningSystemPrompt: null,
    codingSystemPrompt: null,
    executionMode: 'single' as const,
    cycleCount: 0,
    maxCycles: 10,
    config: null,
    result: null,
    parentTaskId: null,
    pipelineMode: 'phase_p',
    pipelineVersionId: null,
    projectId: 'proj-xyz',
    createdAt: '2026-04-23T10:00:00.000Z',
    updatedAt: '2026-04-23T10:00:00.000Z',
    ...overrides,
  } as Parameters<typeof buildTriggerContext>[0];
}

describe('buildTriggerContext', () => {
  it('1. returns kind=task_created, taskId, projectId', () => {
    const ctx = buildTriggerContext(makeTask());
    expect(ctx.kind).toBe('task_created');
    expect(ctx.taskId).toBe('task-abc');
    expect(ctx.projectId).toBe('proj-xyz');
  });

  it('2. optional fields userId/category/priority are undefined when not set', () => {
    const ctx = buildTriggerContext(makeTask());
    expect(ctx.userId).toBeUndefined();
    expect(ctx.category).toBeUndefined();
    expect(ctx.priority).toBeUndefined();
  });

  it('3. createdAt is the task createdAt ISO string', () => {
    const ctx = buildTriggerContext(makeTask({ createdAt: '2026-04-23T10:00:00.000Z' }));
    expect(ctx.createdAt).toBe('2026-04-23T10:00:00.000Z');
    // valid ISO format
    expect(() => new Date(ctx.createdAt)).not.toThrow();
  });

  it('4. projectId falls back to empty string when task.projectId is null', () => {
    const ctx = buildTriggerContext(makeTask({ projectId: null }));
    expect(ctx.projectId).toBe('');
  });
});
