import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupCleanCli } from './helpers';
import type { ExecutionContext } from '../../types';
import type { AgentInput } from '@/agents/interfaces';
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

vi.mock('@/lib/plugins/agents/gemini-cli', () => ({
  GeminiCliAgent: vi.fn().mockImplementation(function (this: any) {}),
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

describe('GeminiCLIBackend', () => {
  let backend: import('../backends/gemini-cli').GeminiCLIBackend;
  let PlanningAgentMock: ReturnType<typeof vi.fn>;
  let CodingAgentWrapperMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { GeminiCLIBackend } = await import('../backends/gemini-cli');
    const { PlanningAgent } = await import('@/agents/planning/planning-agent');
    const { CodingAgentWrapper } = await import('@/agents/coding/coding-agent');
    backend = new GeminiCLIBackend();
    PlanningAgentMock = PlanningAgent as unknown as ReturnType<typeof vi.fn>;
    CodingAgentWrapperMock = CodingAgentWrapper as unknown as ReturnType<typeof vi.fn>;
  });

  const input: AgentInput = {
    prompt: 'do something',
    context: { projectDir: '/tmp' },
    config: {},
  };

  it('id is gemini-cli', () => {
    expect(backend.id).toBe('gemini-cli');
  });

  it('calls PlanningAgent with gemini-cli mode for planner role', async () => {
    await backend.run('planner', input, makeCtx(), makeOptions());
    expect(PlanningAgentMock).toHaveBeenCalledWith('gemini-cli');
  });

  it('calls CodingAgentWrapper with GeminiCliAgent for coder role', async () => {
    const { GeminiCliAgent } = await import('@/lib/plugins/agents/gemini-cli');
    await backend.run('coder', input, makeCtx(), makeOptions());
    expect(CodingAgentWrapperMock).toHaveBeenCalledOnce();
    expect(GeminiCliAgent).toHaveBeenCalledOnce();
  });

  it('returns success for planner role', async () => {
    const output = await backend.run('planner', input, makeCtx(), makeOptions());
    expect(output.success).toBe(true);
  });

  it('returns success for coder role', async () => {
    const output = await backend.run('coder', input, makeCtx(), makeOptions());
    expect(output.success).toBe(true);
  });

  it('propagates error when GeminiCliAgent.invoke throws', async () => {
    CodingAgentWrapperMock.mockImplementationOnce(function (this: any) {
      this.invoke = vi.fn().mockRejectedValue(new Error('gemini failed'));
    });
    await expect(backend.run('coder', input, makeCtx(), makeOptions())).rejects.toThrow('gemini failed');
  });
});
