import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import type { ShellNodeSpec } from '@/lib/adpl/types/nodes/shell';
import type { ExecutionContext, ExecutionOptions } from '../types';
import type { ShellOutputEvent } from '../../events/types';
import { injectStdin } from './stdin-injector';
import { MAX_OUTPUT_BYTES } from './output-parser';

// TODO: extract spawn utility in Stage 3 retro

const DEFAULT_TIMEOUT_MS = 30_000;

export interface SpawnOpts {
  env: Record<string, string>;
  stdin: Buffer | null;
  ctx: ExecutionContext;
  options: ExecutionOptions;
}

export interface SpawnResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
  timedOut: boolean;
  outputTruncated: boolean;
}

export async function runSpawn(spec: ShellNodeSpec, opts: SpawnOpts): Promise<SpawnResult> {
  const { env, stdin, ctx, options } = opts;
  const taskAny = ctx.$task as unknown as Record<string, unknown>;
  const runId = (taskAny?.id as string) ?? 'unknown';
  const nodeId = spec.id;
  const cwd = spec.cwd ?? ctx.worktreeRoot;
  const timeoutMs = spec.timeout != null ? spec.timeout * 1000 : DEFAULT_TIMEOUT_MS;
  const isShellMode = (spec.mode ?? 'shell') === 'shell';

  // Use ChildProcess type assertion to avoid TypeScript overload intersection reducing to never
  const child = spawn(
    spec.command,
    isShellMode ? [] : (spec.args ?? []),
    {
      shell: isShellMode,
      cwd,
      env: env as NodeJS.ProcessEnv,
      detached: true,
      stdio: 'pipe',
    },
  ) as ChildProcess;

  const killGroup = () => {
    if (child.pid != null) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already dead */ }
    }
    try { child.kill('SIGKILL'); } catch { /* already dead */ }
  };

  const cancelDispose = options.cancellationToken.onCancel(killGroup);

  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    killGroup();
  }, timeoutMs);

  if (stdin) {
    injectStdin(child, stdin).catch(() => { child.stdin?.destroy(); });
  } else {
    child.stdin?.end();
  }

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutSize = 0;
  let stderrSize = 0;
  let outputTruncated = false;

  child.stdout?.on('data', (chunk: Buffer) => {
    if (stdoutSize + chunk.length <= MAX_OUTPUT_BYTES) {
      stdoutChunks.push(chunk);
      stdoutSize += chunk.length;
      options.eventBus.emit({
        type: 'shell.output',
        timestamp: new Date(),
        runId,
        nodeId,
        stream: 'stdout',
        chunk: chunk.toString('utf-8'),
      } as ShellOutputEvent);
    } else {
      outputTruncated = true;
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderrSize + chunk.length <= MAX_OUTPUT_BYTES) {
      stderrChunks.push(chunk);
      stderrSize += chunk.length;
      options.eventBus.emit({
        type: 'shell.output',
        timestamp: new Date(),
        runId,
        nodeId,
        stream: 'stderr',
        chunk: chunk.toString('utf-8'),
      } as ShellOutputEvent);
    } else {
      outputTruncated = true;
    }
  });

  return new Promise<SpawnResult>((resolve) => {
    const finish = (code: number | null) => {
      clearTimeout(timeoutHandle);
      cancelDispose();
      resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        exitCode: code ?? (timedOut ? 124 : 1),
        timedOut,
        outputTruncated,
      });
    };

    child.on('close', (code) => finish(code));
    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      cancelDispose();
      resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.from(err.message),
        exitCode: 1,
        timedOut: false,
        outputTruncated,
      });
    });
  });
}
