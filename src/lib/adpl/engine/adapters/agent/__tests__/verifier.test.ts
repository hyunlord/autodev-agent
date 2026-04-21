import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupCleanCli } from './helpers';
import type { ExecutionContext } from '../../types';
import type { AgentInput } from '@/agents/interfaces';
import { CancellationToken } from '../../../cancel/token';
import { EventBus } from '../../../events/bus';

setupCleanCli();

vi.mock('@/agents/verify/verify-agent', () => {
  const mockOutput = {
    success: true,
    result: { score: 90, passed: true, verdict: 'pass', reason: 'ok', issues: [], suggestions: [], evidence: {} },
    costUsd: 0.01,
    tokenUsage: { input: 50, output: 20 },
    durationMs: 100,
  };

  const VerifyAgent = vi.fn().mockImplementation(function (this: any, llm = 'claude-cli') {
    this.id = `verify-${llm}`;
    this.invoke = vi.fn().mockResolvedValue(mockOutput);
  });

  (VerifyAgent as any).selectDifferentFrom = vi.fn().mockImplementation(async (coderModel: string) => {
    const primaryLlm = coderModel === 'autodev-internal' ? 'codex-cli' : 'gemini-cli';
    const primary = new (VerifyAgent as any)(primaryLlm);
    return { primary, fallbacks: [] };
  });

  return { VerifyAgent };
});

function makeCtx(codeAgentModel?: string): ExecutionContext {
  const ctx: ExecutionContext = {
    $task: {
      id: 'run-1',
      prompt: 'build something',
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
    $self: { pathId: 'agent.verify' } as any,
    $nodes: {},
    $prev: null,
    $loop: null,
    $flow: null,
    $variables: {},
    worktreeRoot: '/tmp/test-worktree',
  };

  if (codeAgentModel !== undefined) {
    ctx.$nodes['code'] = {
      status: 'success',
      data: { text: 'code output', modifiedFiles: ['src/foo.ts'] },
      metrics: { durationMs: 200, agentModel: codeAgentModel },
    };
  }

  return ctx;
}

function makeOptions() {
  return {
    cancellationToken: new CancellationToken(),
    eventBus: new EventBus(),
    timeoutMs: 30_000,
  };
}

const input: AgentInput = {
  prompt: 'verify the code',
  context: { projectDir: '/tmp/test-worktree' },
  config: {},
};

describe('VerifierBackend', () => {
  let backend: import('../backends/verifier').VerifierBackend;
  let VerifyAgentMock: ReturnType<typeof vi.fn> & { selectDifferentFrom: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { VerifierBackend } = await import('../backends/verifier');
    const { VerifyAgent } = await import('@/agents/verify/verify-agent');
    VerifyAgentMock = VerifyAgent as any;
    backend = new VerifierBackend('auto-cross-model');
  });

  it('id reflects the model passed to constructor', async () => {
    const { VerifierBackend } = await import('../backends/verifier');
    const b = new VerifierBackend('codex-cli');
    expect(b.id).toBe('codex-cli');
  });

  it('auto-cross-model calls selectDifferentFrom with coderModel from ctx.$nodes.code.metrics', async () => {
    await backend.run('verifier', input, makeCtx('claude-code'), makeOptions());
    expect(VerifyAgentMock.selectDifferentFrom).toHaveBeenCalledWith('claude-code');
  });

  it('auto-cross-model defaults coderModel to autodev-internal when code node is absent', async () => {
    await backend.run('verifier', input, makeCtx(), makeOptions());
    expect(VerifyAgentMock.selectDifferentFrom).toHaveBeenCalledWith('autodev-internal');
  });

  it('specific model creates VerifyAgent directly without calling selectDifferentFrom', async () => {
    const { VerifierBackend } = await import('../backends/verifier');
    const b = new VerifierBackend('codex-cli');
    await b.run('verifier', input, makeCtx(), makeOptions());
    expect(VerifyAgentMock.selectDifferentFrom).not.toHaveBeenCalled();
    expect(VerifyAgentMock).toHaveBeenCalledWith('codex-cli');
  });

  it('returns success AgentOutput from invoke', async () => {
    const output = await backend.run('verifier', input, makeCtx(), makeOptions());
    expect(output.success).toBe(true);
    expect((output.result as any).score).toBe(90);
  });

  it('propagates error when invoke throws', async () => {
    VerifyAgentMock.selectDifferentFrom.mockResolvedValueOnce({
      primary: {
        id: 'verify-codex-cli',
        invoke: vi.fn().mockRejectedValue(new Error('verify failed')),
      },
      fallbacks: [],
    });
    await expect(backend.run('verifier', input, makeCtx(), makeOptions())).rejects.toThrow('verify failed');
  });

  it('passes input directly to verifyAgent.invoke', async () => {
    const { VerifierBackend } = await import('../backends/verifier');
    const b = new VerifierBackend('gemini-cli');
    await b.run('verifier', input, makeCtx(), makeOptions());
    const instance = VerifyAgentMock.mock.results.at(-1)?.value;
    expect(instance.invoke).toHaveBeenCalledWith(input);
  });
});
