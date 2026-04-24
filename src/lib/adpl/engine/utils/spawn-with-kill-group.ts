import { spawn } from 'child_process';
import type { ChildProcess, SpawnOptions } from 'child_process';

export interface SpawnWithKillGroupOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  onSpawn?: (child: ChildProcess) => void;
  maxOutputBytes?: number;
  shell?: boolean;
}

export interface SpawnResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
  truncated: boolean;
  signal?: NodeJS.Signals;
}

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10MB

export async function spawnWithKillGroup(
  opts: SpawnWithKillGroupOptions,
): Promise<SpawnResult> {
  if (opts.signal?.aborted) {
    throw new Error('SPAWN_ABORTED: signal already aborted before spawn');
  }

  const spawnOpts: SpawnOptions = {
    cwd: opts.cwd,
    env: opts.env,
    detached: true,
    shell: opts.shell ?? false,
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  const child = spawn(opts.command, opts.args, spawnOpts);
  opts.onSpawn?.(child);

  const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let truncated = false;

  const killGroup = () => {
    if (child.pid == null) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* ignore */ }
    }
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    if (stdoutBytes < maxBytes) {
      const remaining = maxBytes - stdoutBytes;
      const used = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      stdoutChunks.push(used);
      stdoutBytes += used.length;
      if (chunk.length > remaining) truncated = true;
    } else {
      truncated = true;
    }
    opts.onStdout?.(chunk);
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderrBytes < maxBytes) {
      const remaining = maxBytes - stderrBytes;
      const used = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      stderrChunks.push(used);
      stderrBytes += used.length;
      if (chunk.length > remaining) truncated = true;
    } else {
      truncated = true;
    }
    opts.onStderr?.(chunk);
  });

  if (opts.stdin != null) {
    child.stdin?.write(opts.stdin);
  }
  child.stdin?.end();

  return new Promise<SpawnResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (!settled) { settled = true; fn(); }
    };

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeoutMs != null) {
      timeoutTimer = setTimeout(() => {
        killGroup();
        finish(() => reject(new Error(`SPAWN_TIMEOUT: ${opts.timeoutMs}ms exceeded`)));
      }, opts.timeoutMs);
    }

    const onAbort = () => {
      killGroup();
      finish(() => reject(new Error('SPAWN_ABORTED: signal fired during execution')));
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      if (timeoutTimer != null) clearTimeout(timeoutTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      finish(() => reject(err));
    });

    child.on('close', (exitCode, killSignal) => {
      if (timeoutTimer != null) clearTimeout(timeoutTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      finish(() => resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        exitCode: exitCode ?? 0,
        truncated,
        signal: killSignal ?? undefined,
      }));
    });
  });
}
