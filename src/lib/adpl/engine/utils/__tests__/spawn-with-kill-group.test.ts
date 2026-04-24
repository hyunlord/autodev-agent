import { describe, it, expect } from 'vitest';
import { spawnWithKillGroup } from '../spawn-with-kill-group';

describe('spawnWithKillGroup', () => {
  // ─── normal exit ─────────────────────────────────────
  it('resolves with exitCode 0 and stdout for successful command', async () => {
    const result = await spawnWithKillGroup({
      command: 'node',
      args: ['-e', 'process.stdout.write("hello")'],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString('utf-8')).toBe('hello');
    expect(result.stderr.length).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('returns non-zero exitCode for failing command', async () => {
    const result = await spawnWithKillGroup({
      command: 'node',
      args: ['-e', 'process.exit(7)'],
    });
    expect(result.exitCode).toBe(7);
  });

  it('collects stderr separately from stdout', async () => {
    const result = await spawnWithKillGroup({
      command: 'node',
      args: ['-e', 'process.stderr.write("err-text"); process.stdout.write("out-text")'],
    });
    expect(result.stdout.toString('utf-8')).toBe('out-text');
    expect(result.stderr.toString('utf-8')).toBe('err-text');
  });

  // ─── timeout ─────────────────────────────────────────
  it('throws SPAWN_TIMEOUT when timeoutMs exceeded', async () => {
    await expect(
      spawnWithKillGroup({
        command: 'node',
        args: ['-e', 'setInterval(()=>{},1000)'],
        timeoutMs: 200,
      }),
    ).rejects.toThrow(/SPAWN_TIMEOUT/);
  }, 5_000);

  it('does not throw when command finishes before timeout', async () => {
    const result = await spawnWithKillGroup({
      command: 'node',
      args: ['-e', 'process.stdout.write("fast")'],
      timeoutMs: 10_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString('utf-8')).toBe('fast');
  });

  // ─── abort signal ────────────────────────────────────
  it('throws SPAWN_ABORTED immediately when signal already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      spawnWithKillGroup({
        command: 'node',
        args: ['-e', 'console.log("unreachable")'],
        signal: ctrl.signal,
      }),
    ).rejects.toThrow(/SPAWN_ABORTED/);
  });

  it('throws SPAWN_ABORTED and kills process when signal aborts mid-run', async () => {
    const ctrl = new AbortController();
    const promise = spawnWithKillGroup({
      command: 'node',
      args: ['-e', 'setInterval(()=>{},1000)'],
      signal: ctrl.signal,
    });
    setTimeout(() => ctrl.abort(), 100);
    await expect(promise).rejects.toThrow(/SPAWN_ABORTED/);
  }, 5_000);

  // ─── output truncation ───────────────────────────────
  it('marks truncated=true and caps stdout when maxOutputBytes exceeded', async () => {
    const result = await spawnWithKillGroup({
      command: 'node',
      args: ['-e', 'process.stdout.write("a".repeat(1000))'],
      maxOutputBytes: 100,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(100);
  });

  // ─── callbacks ───────────────────────────────────────
  it('invokes onStdout callback with output chunks', async () => {
    const chunks: string[] = [];
    await spawnWithKillGroup({
      command: 'node',
      args: ['-e', 'process.stdout.write("chunk-one")'],
      onStdout: (chunk) => { chunks.push(chunk.toString('utf-8')); },
    });
    expect(chunks.join('')).toContain('chunk-one');
  });

  it('invokes onStderr callback with error chunks', async () => {
    const chunks: string[] = [];
    await spawnWithKillGroup({
      command: 'node',
      args: ['-e', 'process.stderr.write("err-chunk")'],
      onStderr: (chunk) => { chunks.push(chunk.toString('utf-8')); },
    });
    expect(chunks.join('')).toContain('err-chunk');
  });

  // ─── onSpawn callback ────────────────────────────────
  it('invokes onSpawn with ChildProcess before process exit', async () => {
    let pidFromCallback: number | undefined;
    await spawnWithKillGroup({
      command: 'node',
      args: ['-e', 'process.exit(0)'],
      onSpawn: (child) => { pidFromCallback = child.pid; },
    });
    expect(typeof pidFromCallback).toBe('number');
    expect(pidFromCallback).toBeGreaterThan(0);
  });

  // ─── stdin ───────────────────────────────────────────
  it('pipes stdin string to child process', async () => {
    const result = await spawnWithKillGroup({
      command: 'node',
      args: ['-e', 'let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>process.stdout.write(d))'],
      stdin: 'piped-input',
    });
    expect(result.stdout.toString('utf-8')).toBe('piped-input');
  });
});
