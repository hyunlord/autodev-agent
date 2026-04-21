import { describe, it, expect } from 'vitest';
import { buildShellEnv } from '../env-builder';
import type { ShellNodeSpec } from '@/lib/adpl/types/nodes/shell';
import type { ExecutionContext } from '../../types';

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    $task: {
      id: 'task-123',
      pipelineVersionId: 'run-abc',
      prompt: '',
      tags: [],
      createdAt: '',
      pipelineMode: 'pipeline',
      projectId: 'proj-1',
      status: 'running',
      config: {},
    } as unknown as ExecutionContext['$task'],
    $project: {
      id: 'proj-1',
      name: 'test-project',
      path: '/tmp/proj',
      description: null,
      createdAt: '',
    } as unknown as ExecutionContext['$project'],
    $trigger: {} as ExecutionContext['$trigger'],
    $env: {},
    $now: new Date(),
    $self: { id: 'node-1' } as unknown as ExecutionContext['$self'],
    $nodes: {},
    $prev: null,
    $loop: null,
    $flow: null,
    $variables: {},
    worktreeRoot: '/tmp/worktree',
    ...overrides,
  };
}

function makeSpec(overrides: Partial<ShellNodeSpec> = {}): ShellNodeSpec {
  return { id: 'test-node', type: 'shell', command: 'echo hi', ...overrides };
}

describe('buildShellEnv', () => {
  it('injects AUTODEV_WORKTREE from ctx.worktreeRoot', () => {
    const env = buildShellEnv(makeSpec(), makeCtx());
    expect(env.AUTODEV_WORKTREE).toBe('/tmp/worktree');
  });

  it('injects AUTODEV_NODE_ID from spec.id', () => {
    const env = buildShellEnv(makeSpec({ id: 'my-node' }), makeCtx());
    expect(env.AUTODEV_NODE_ID).toBe('my-node');
  });

  it('injects AUTODEV_PROJECT_ID from ctx.$project.id', () => {
    const env = buildShellEnv(makeSpec(), makeCtx());
    expect(env.AUTODEV_PROJECT_ID).toBe('proj-1');
  });

  it('injects AUTODEV_RUN_ID from pipelineVersionId', () => {
    const env = buildShellEnv(makeSpec(), makeCtx());
    expect(env.AUTODEV_RUN_ID).toBe('run-abc');
  });

  it('spec.env overrides AUTODEV vars and process.env', () => {
    const spec = makeSpec({ env: { MY_VAR: 'custom', AUTODEV_NODE_ID: 'overridden' } });
    const env = buildShellEnv(spec, makeCtx());
    expect(env.MY_VAR).toBe('custom');
    expect(env.AUTODEV_NODE_ID).toBe('overridden');
  });

  it('inherits process.env', () => {
    const env = buildShellEnv(makeSpec(), makeCtx());
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('returns empty string for AUTODEV_PROJECT_ID when project is missing', () => {
    const ctx = makeCtx({ $project: undefined as unknown as ExecutionContext['$project'] });
    const env = buildShellEnv(makeSpec(), ctx);
    expect(env.AUTODEV_PROJECT_ID).toBe('');
  });
});
