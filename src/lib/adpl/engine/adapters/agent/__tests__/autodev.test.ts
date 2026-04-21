import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupCleanCli } from './helpers';
import type { ExecutionContext } from '../../types';
import { CancellationToken } from '../../../cancel/token';
import { EventBus } from '../../../events/bus';

setupCleanCli();

vi.mock('@/agents/planning/planning-agent', () => ({
  PlanningAgent: vi.fn().mockImplementation(function (this: any) {
    this.invoke = vi.fn().mockResolvedValue({
      success: true,
      result: 'plan result',
      costUsd: 0.01,
      tokenUsage: { input: 100, output: 50 },
      durationMs: 100,
    });
  }),
}));

vi.mock('@/agents/coding/coding-agent', () => ({
  CodingAgentWrapper: vi.fn().mockImplementation(function (this: any) {
    this.invoke = vi.fn().mockResolvedValue({
      success: true,
      result: { text: 'code result', modifiedFiles: [] },
      costUsd: 0.02,
      tokenUsage: { input: 200, output: 100 },
      durationMs: 200,
    });
  }),
}));

vi.mock('@/lib/plugins/agents/claude-code', () => ({
  ClaudeCodeAgent: vi.fn().mockImplementation(function (this: any) {}),
}));

function makeCtx(): ExecutionContext {
  return {
    $task: {
      id: 'run-1',
      prompt: 'test task',
      tags: [],
      createdAt: new Date().toISOString(),
      pipelineMode: 'pipeline',
      projectId: null,
      pipelineVersionId: null,
      status: 'running',
      config: {},
    } as any,
    $project: null as never,
    $trigger: null as never,
    $env: {},
    $now: new Date(),
    $self: { pathId: 'agent.n1' } as any,
    $nodes: {},
    $prev: null,
    $loop: null,
    $flow: null,
    $variables: {},
    worktreeRoot: '/tmp/test-worktree',
  };
}

function makeOptions() {
  return {
    cancellationToken: new CancellationToken(),
    eventBus: new EventBus(),
    timeoutMs: 30_000,
  };
}

describe('AutoDevAgentBackend', () => {
  let backend: import('../backends/autodev').AutoDevAgentBackend;
  let PlanningAgentMock: ReturnType<typeof vi.fn>;
  let CodingAgentWrapperMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { AutoDevAgentBackend } = await import('../backends/autodev');
    const { PlanningAgent } = await import('@/agents/planning/planning-agent');
    const { CodingAgentWrapper } = await import('@/agents/coding/coding-agent');
    backend = new AutoDevAgentBackend();
    PlanningAgentMock = PlanningAgent as unknown as ReturnType<typeof vi.fn>;
    CodingAgentWrapperMock = CodingAgentWrapper as unknown as ReturnType<typeof vi.fn>;
  });

  const input = {
    prompt: 'do something',
    context: { projectDir: '/tmp' },
    config: {},
  };

  it('id is autodev-internal', () => {
    expect(backend.id).toBe('autodev-internal');
  });

  it('calls PlanningAgent.invoke for planner role', async () => {
    await backend.run('planner', input, makeCtx(), makeOptions());
    expect(PlanningAgentMock).toHaveBeenCalledOnce();
    const instance = PlanningAgentMock.mock.results[0].value;
    expect(instance.invoke).toHaveBeenCalledOnce();
  });

  it('calls CodingAgentWrapper.invoke for coder role', async () => {
    await backend.run('coder', input, makeCtx(), makeOptions());
    expect(CodingAgentWrapperMock).toHaveBeenCalledOnce();
    const instance = CodingAgentWrapperMock.mock.results[0].value;
    expect(instance.invoke).toHaveBeenCalledOnce();
  });

  it('returns success output for planner role', async () => {
    const output = await backend.run('planner', input, makeCtx(), makeOptions());
    expect(output.success).toBe(true);
  });

  it('returns success output for coder role', async () => {
    const output = await backend.run('coder', input, makeCtx(), makeOptions());
    expect(output.success).toBe(true);
  });

  it('propagates error when PlanningAgent.invoke throws', async () => {
    PlanningAgentMock.mockImplementationOnce(function (this: any) {
      this.invoke = vi.fn().mockRejectedValue(new Error('planning failed'));
    });
    await expect(backend.run('planner', input, makeCtx(), makeOptions())).rejects.toThrow('planning failed');
  });
});
