import { describe, it, expect } from 'vitest';
import { transformInput, buildVerifierInput } from '../input-transform';
import { setupCleanCli } from './helpers';
import type { ExecutionContext } from '../../types';
import type { AgentNodeSpec } from '@/lib/adpl/types/nodes/agent';
import type { PipelineEvent } from '@/lib/types';

setupCleanCli();

function makeCtx(): ExecutionContext {
  return {
    $task: {
      id: 'run-1',
      prompt: 'task prompt',
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
    worktreeRoot: '/tmp/test',
  };
}

const noop = (_: PipelineEvent) => {};

describe('transformInput', () => {
  it('uses spec.prompt as the prompt', () => {
    const spec: AgentNodeSpec = { id: 'n1', type: 'agent', prompt: 'spec prompt' };
    const input = transformInput(spec, makeCtx(), noop);
    expect(input.prompt).toBe('spec prompt');
  });

  it('falls back to ctx.$task.prompt when spec.prompt is undefined', () => {
    const spec: AgentNodeSpec = { id: 'n1', type: 'agent' };
    const input = transformInput(spec, makeCtx(), noop);
    expect(input.prompt).toBe('task prompt');
  });

  it('replaces $prev.data in prompt', () => {
    const spec: AgentNodeSpec = { id: 'n1', type: 'agent', prompt: 'result: $prev.data' };
    const ctx = makeCtx();
    ctx.$prev = { status: 'success', data: 'prev-output' };
    const input = transformInput(spec, ctx, noop);
    expect(input.prompt).toBe('result: prev-output');
  });

  it('replaces $nodes.<userId>.data in prompt', () => {
    const spec: AgentNodeSpec = { id: 'n1', type: 'agent', prompt: 'plan: $nodes.plan.data' };
    const ctx = makeCtx();
    ctx.$nodes = { plan: { status: 'success', data: 'plan-output' } };
    const input = transformInput(spec, ctx, noop);
    expect(input.prompt).toBe('plan: plan-output');
  });

  it('does not set previousResults key when useMemory is false', () => {
    const spec: AgentNodeSpec = { id: 'n1', type: 'agent', useMemory: false };
    const input = transformInput(spec, makeCtx(), noop);
    expect(Object.prototype.hasOwnProperty.call(input.context, 'previousResults')).toBe(false);
  });

  it('sets previousResults when useMemory is true', () => {
    const spec: AgentNodeSpec = { id: 'n1', type: 'agent', useMemory: true };
    const ctx = makeCtx();
    ctx.$nodes = { plan: { status: 'success', data: 'plan-output' } };
    const input = transformInput(spec, ctx, noop);
    expect(input.context.previousResults).toBeDefined();
    expect((input.context.previousResults as any)['plan']).toBe('plan-output');
  });

  it('sets context.projectDir to ctx.worktreeRoot', () => {
    const spec: AgentNodeSpec = { id: 'n1', type: 'agent' };
    const input = transformInput(spec, makeCtx(), noop);
    expect(input.context.projectDir).toBe('/tmp/test');
  });

  it('converts spec.timeout (seconds) to timeoutMs (milliseconds)', () => {
    const spec: AgentNodeSpec = { id: 'n1', type: 'agent', timeout: 60 };
    const input = transformInput(spec, makeCtx(), noop);
    expect(input.config.timeoutMs).toBe(60_000);
  });
});

describe('buildVerifierInput', () => {
  it('sets originalPrompt from ctx.$task.prompt', () => {
    const spec: AgentNodeSpec = { id: 'verify', type: 'agent', role: 'verifier' };
    const input = buildVerifierInput(spec, makeCtx(), noop);
    expect(input.originalPrompt).toBe('task prompt');
  });

  it('sets projectDir from ctx.worktreeRoot', () => {
    const spec: AgentNodeSpec = { id: 'verify', type: 'agent', role: 'verifier' };
    const input = buildVerifierInput(spec, makeCtx(), noop);
    expect(input.projectDir).toBe('/tmp/test');
  });

  it('reads modifiedFiles from ctx.$nodes.code.data', () => {
    const spec: AgentNodeSpec = { id: 'verify', type: 'agent', role: 'verifier' };
    const ctx = makeCtx();
    ctx.$nodes = {
      code: {
        status: 'success',
        data: { text: 'generated code', modifiedFiles: ['src/foo.ts', 'src/bar.ts'] },
        metrics: { durationMs: 100 },
      },
    };
    const input = buildVerifierInput(spec, ctx, noop);
    expect(input.modifiedFiles).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('defaults modifiedFiles to empty array when code node is absent', () => {
    const spec: AgentNodeSpec = { id: 'verify', type: 'agent', role: 'verifier' };
    const input = buildVerifierInput(spec, makeCtx(), noop);
    expect(input.modifiedFiles).toEqual([]);
  });
});
