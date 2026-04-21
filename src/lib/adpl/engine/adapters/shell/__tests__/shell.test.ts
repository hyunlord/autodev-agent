import { describe, it, expect, beforeEach } from 'vitest';
import { shellAdapter } from '../index';
import { CancellationToken } from '../../../cancel/token';
import { EventBus } from '../../../events/bus';
import type { ShellNodeSpec } from '@/lib/adpl/types/nodes/shell';
import type { ExecutionContext, ExecutionOptions } from '../../types';
import type { ShellOutputEvent } from '../../../events/types';

function makeCtx(worktreeRoot = process.cwd()): ExecutionContext {
  return {
    $task: {
      id: 'task-test',
      pipelineVersionId: 'run-test',
      prompt: '',
      tags: [],
      createdAt: '',
      pipelineMode: 'pipeline',
      projectId: 'proj-test',
      status: 'running',
      config: {},
    } as unknown as ExecutionContext['$task'],
    $project: {
      id: 'proj-test',
      name: 'test',
      path: worktreeRoot,
      description: null,
      createdAt: '',
    } as unknown as ExecutionContext['$project'],
    $trigger: {} as ExecutionContext['$trigger'],
    $env: {},
    $now: new Date(),
    $self: { id: 'shell-test' } as unknown as ExecutionContext['$self'],
    $nodes: {},
    $prev: null,
    $loop: null,
    $flow: null,
    $variables: {},
    worktreeRoot,
  };
}

function makeOptions(overrides: Partial<ExecutionOptions> = {}): ExecutionOptions {
  return {
    cancellationToken: new CancellationToken(),
    eventBus: new EventBus(),
    timeoutMs: 0,
    ...overrides,
  };
}

function spec(command: string, extra: Partial<ShellNodeSpec> = {}): ShellNodeSpec {
  return { id: 'test', type: 'shell', command, ...extra };
}

describe('shellAdapter — E2E', () => {
  let ctx: ExecutionContext;
  let opts: ExecutionOptions;

  beforeEach(() => {
    ctx = makeCtx();
    opts = makeOptions();
  });

  // ─── success path ────────────────────────────────────
  it('echo hello — success, exitCode 0, stdout contains hello', async () => {
    const result = await shellAdapter.execute(spec('echo hello'), ctx, opts);
    expect(result.status).toBe('success');
    const data = result.data as Record<string, unknown>;
    expect(data.exitCode).toBe(0);
    expect(String(data.stdout)).toContain('hello');
  });

  it('outputFormat auto — non-JSON text falls back to string', async () => {
    const result = await shellAdapter.execute(
      spec('echo hello', { outputFormat: 'auto' }),
      ctx,
      opts,
    );
    expect(result.status).toBe('success');
    const data = result.data as Record<string, unknown>;
    expect(typeof data.stdout).toBe('string');
    expect(String(data.stdout)).toContain('hello');
  });

  it('outputFormat auto — JSON output is parsed to object', async () => {
    const result = await shellAdapter.execute(
      spec('node -e "console.log(JSON.stringify({a:1,b:2}))"', { outputFormat: 'auto' }),
      ctx,
      opts,
    );
    expect(result.status).toBe('success');
    const data = result.data as Record<string, unknown>;
    expect(data.stdout).toEqual({ a: 1, b: 2 });
  });

  it('allowExitCodes [2] — exit 2 treated as success', async () => {
    const result = await shellAdapter.execute(
      spec('node -e "process.exit(2)"', { allowExitCodes: [2] }),
      ctx,
      opts,
    );
    expect(result.status).toBe('success');
    const data = result.data as Record<string, unknown>;
    expect(data.exitCode).toBe(2);
  });

  it('non-zero exit without allowExitCodes — status failure', async () => {
    const result = await shellAdapter.execute(
      spec('node -e "process.exit(1)"'),
      ctx,
      opts,
    );
    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('exit_1');
  });

  it('failOnNonZero: false — non-zero exit still returns success', async () => {
    const result = await shellAdapter.execute(
      spec('node -e "process.exit(3)"', { failOnNonZero: false }),
      ctx,
      opts,
    );
    expect(result.status).toBe('success');
    const data = result.data as Record<string, unknown>;
    expect(data.exitCode).toBe(3);
  });

  // ─── timeout ─────────────────────────────────────────
  it('timeout 1s kills infinite loop and returns failure(timeout)', async () => {
    const result = await shellAdapter.execute(
      spec('node -e "setInterval(()=>{},1000)"', { timeout: 1 }),
      ctx,
      opts,
    );
    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('timeout');
    expect(result.error?.category).toBe('timeout');
  }, 8_000);

  // ─── cancellation ────────────────────────────────────
  it('CancellationToken cancel — process is killed and promise resolves', async () => {
    const token = new CancellationToken();
    const localOpts = makeOptions({ cancellationToken: token });
    const promise = shellAdapter.execute(
      spec('node -e "setInterval(()=>{},1000)"'),
      ctx,
      localOpts,
    );
    setTimeout(() => token.cancel('test-cancel'), 150);
    const result = await promise;
    // Process should have been killed → non-zero exit
    const data = result.data as Record<string, unknown>;
    expect(data.exitCode).not.toBe(0);
  }, 5_000);

  // ─── shell.output events ─────────────────────────────
  it('emits shell.output events for stderr', async () => {
    const bus = new EventBus();
    const emitted: ShellOutputEvent[] = [];
    bus.on('shell.output', (e) => { emitted.push(e as ShellOutputEvent); });

    const localOpts = makeOptions({ eventBus: bus });
    await shellAdapter.execute(
      spec('node -e "process.stderr.write(\'err-line\\n\')"'),
      ctx,
      localOpts,
    );

    const stderrEvents = emitted.filter((e) => e.stream === 'stderr');
    expect(stderrEvents.length).toBeGreaterThan(0);
    expect(stderrEvents.some((e) => e.chunk.includes('err-line'))).toBe(true);
  });

  it('emits shell.output events for stdout', async () => {
    const bus = new EventBus();
    const emitted: ShellOutputEvent[] = [];
    bus.on('shell.output', (e) => { emitted.push(e as ShellOutputEvent); });

    const localOpts = makeOptions({ eventBus: bus });
    await shellAdapter.execute(spec('echo streaming-test'), ctx, localOpts);

    const stdoutEvents = emitted.filter((e) => e.stream === 'stdout');
    expect(stdoutEvents.length).toBeGreaterThan(0);
    expect(stdoutEvents.some((e) => e.chunk.includes('streaming-test'))).toBe(true);
  });
});

describe('shellAdapter — validate()', () => {
  it('returns valid:true for safe command', () => {
    const result = shellAdapter.validate(spec('echo hello'));
    expect(result.valid).toBe(true);
  });

  it('returns valid:false for destructive command', () => {
    const result = shellAdapter.validate(spec('sudo rm -rf /'));
    expect(result.valid).toBe(false);
    expect((result.errors?.length ?? 0)).toBeGreaterThan(0);
  });
});

describe('shellAdapter — defaultTimeout()', () => {
  it('returns 30 seconds', () => {
    expect(shellAdapter.defaultTimeout()).toBe(30);
  });
});
