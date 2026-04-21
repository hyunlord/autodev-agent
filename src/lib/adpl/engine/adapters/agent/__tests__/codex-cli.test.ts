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

vi.mock('@/lib/plugins/agents/codex-cli', () => ({
  CodexCliAgent: vi.fn().mockImplementation(function (this: any) {}),
}));

const MAX_PROMPT_LENGTH = 12_000;

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

describe('CodexCLIBackend', () => {
  let backend: import('../backends/codex-cli').CodexCLIBackend;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { CodexCLIBackend } = await import('../backends/codex-cli');
    backend = new CodexCLIBackend();
  });

  it('does not emit agent.fallback for short prompt (< 12000 chars)', async () => {
    const options = makeOptions();
    const fallbackEvents: any[] = [];
    options.eventBus.on('agent.fallback', (e) => { fallbackEvents.push(e); });

    const input: AgentInput = {
      prompt: 'short prompt',
      context: { projectDir: '/tmp' },
      config: {},
    };

    await backend.run('planner', input, makeCtx(), options);
    expect(fallbackEvents).toHaveLength(0);
  });

  it('emits agent.fallback for long prompt (> 12000 chars)', async () => {
    const options = makeOptions();
    const fallbackEvents: any[] = [];
    options.eventBus.on('agent.fallback', (e) => { fallbackEvents.push(e); });

    const input: AgentInput = {
      prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1),
      context: { projectDir: '/tmp' },
      config: {},
    };

    await backend.run('planner', input, makeCtx(), options);
    expect(fallbackEvents).toHaveLength(1);
    expect(fallbackEvents[0].from).toBe('full-prompt');
    expect(fallbackEvents[0].to).toBe('truncated-prompt');
    expect(fallbackEvents[0].reason).toBe('prompt-truncated');
  });

  it('returns success for planner role', async () => {
    const input: AgentInput = {
      prompt: 'do something',
      context: { projectDir: '/tmp' },
      config: {},
    };
    const output = await backend.run('planner', input, makeCtx(), makeOptions());
    expect(output.success).toBe(true);
  });

  it('returns success for coder role', async () => {
    const input: AgentInput = {
      prompt: 'do something',
      context: { projectDir: '/tmp' },
      config: {},
    };
    const output = await backend.run('coder', input, makeCtx(), makeOptions());
    expect(output.success).toBe(true);
  });

  it('does not emit agent.fallback for prompt exactly at MAX_PROMPT_LENGTH (12000 chars)', async () => {
    const options = makeOptions();
    const fallbackEvents: any[] = [];
    options.eventBus.on('agent.fallback', (e) => { fallbackEvents.push(e); });

    const input: AgentInput = {
      prompt: 'x'.repeat(MAX_PROMPT_LENGTH),
      context: { projectDir: '/tmp' },
      config: {},
    };

    await backend.run('planner', input, makeCtx(), options);
    expect(fallbackEvents).toHaveLength(0);
  });
});
