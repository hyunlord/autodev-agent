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

describe('ClaudeCodeBackend', () => {
  let backend: import('../backends/claude-code').ClaudeCodeBackend;
  let PlanningAgentMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { ClaudeCodeBackend } = await import('../backends/claude-code');
    const { PlanningAgent } = await import('@/agents/planning/planning-agent');
    backend = new ClaudeCodeBackend();
    PlanningAgentMock = PlanningAgent as unknown as ReturnType<typeof vi.fn>;
  });

  const baseInput: AgentInput = {
    prompt: 'do something',
    context: { projectDir: '/tmp' },
    config: {},
  };

  it('id is claude-code', () => {
    expect(backend.id).toBe('claude-code');
  });

  it('returns success for coder role', async () => {
    const output = await backend.run('coder', baseInput, makeCtx(), makeOptions());
    expect(output.success).toBe(true);
  });

  it('returns success for planner role', async () => {
    const output = await backend.run('planner', baseInput, makeCtx(), makeOptions());
    expect(output.success).toBe(true);
  });

  it('emits agent.fallback event when onProgress receives SDK-to-CLI fallback warning', async () => {
    const options = makeOptions();
    const emittedEvents: any[] = [];
    options.eventBus.on('agent.fallback', (e) => { emittedEvents.push(e); });

    PlanningAgentMock.mockImplementationOnce(function (this: any) {
      this.invoke = vi.fn().mockImplementation(async (inp: AgentInput) => {
        inp.onProgress?.({
          type: 'log',
          level: 'warn',
          message: 'Claude Code SDK not available, falling back to CLI: error',
        });
        return {
          success: true,
          result: 'plan result',
          costUsd: 0.01,
          tokenUsage: { input: 100, output: 50 },
          durationMs: 100,
        };
      });
    });

    const inputWithProgress: AgentInput = { ...baseInput, onProgress: undefined };
    await backend.run('planner', inputWithProgress, makeCtx(), options);

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].from).toBe('sdk');
    expect(emittedEvents[0].to).toBe('cli');
  });

  it('does not emit fallback when warn message does not contain "falling back to CLI"', async () => {
    const options = makeOptions();
    const emittedEvents: any[] = [];
    options.eventBus.on('agent.fallback', (e) => { emittedEvents.push(e); });

    PlanningAgentMock.mockImplementationOnce(function (this: any) {
      this.invoke = vi.fn().mockImplementation(async (inp: AgentInput) => {
        inp.onProgress?.({
          type: 'log',
          level: 'warn',
          message: 'Some other warning message',
        });
        return {
          success: true,
          result: 'plan result',
          costUsd: 0.01,
          tokenUsage: { input: 100, output: 50 },
          durationMs: 100,
        };
      });
    });

    await backend.run('planner', baseInput, makeCtx(), options);
    expect(emittedEvents).toHaveLength(0);
  });

  it('still calls original onProgress when fallback is detected', async () => {
    const options = makeOptions();
    const originalOnProgress = vi.fn();

    const inputWithProgress: AgentInput = { ...baseInput, onProgress: originalOnProgress };

    PlanningAgentMock.mockImplementationOnce(function (this: any) {
      this.invoke = vi.fn().mockImplementation(async (inp: AgentInput) => {
        inp.onProgress?.({
          type: 'log',
          level: 'warn',
          message: 'Claude Code SDK not available, falling back to CLI: error',
        });
        return {
          success: true,
          result: 'plan result',
          costUsd: 0.01,
          tokenUsage: { input: 100, output: 50 },
          durationMs: 100,
        };
      });
    });

    await backend.run('planner', inputWithProgress, makeCtx(), options);
    expect(originalOnProgress).toHaveBeenCalledOnce();
  });
});
