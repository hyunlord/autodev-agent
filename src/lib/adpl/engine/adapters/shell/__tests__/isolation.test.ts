import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { computeIsolatedCwd } from '../isolation';

describe('computeIsolatedCwd — Stage 6 F4', () => {
  let workRoot: string;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'phase-p-iso-'));
  });

  afterEach(async () => {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  // 1.
  it('useIsolation=true + runId → creates namespace dir and returns isolated cwd', async () => {
    const runId = 'run-abc123';
    const result = await computeIsolatedCwd({ worktreeRoot: workRoot, runId, useIsolation: true });

    expect(result.isolated).toBe(true);
    expect(result.cwd).toBe(resolve(workRoot, '.phase-p-runs', runId));
    expect(result.isolatedPath).toBe(result.cwd);

    // Directory exists
    const s = await stat(result.cwd);
    expect(s.isDirectory()).toBe(true);
  });

  // 2.
  it('useIsolation=false → returns worktreeRoot unchanged, no dir created', async () => {
    const result = await computeIsolatedCwd({ worktreeRoot: workRoot, runId: 'ignored', useIsolation: false });

    expect(result.isolated).toBe(false);
    expect(result.cwd).toBe(resolve(workRoot));
    expect(result.isolatedPath).toBeUndefined();

    // No .phase-p-runs directory should have been created
    await expect(stat(join(workRoot, '.phase-p-runs'))).rejects.toThrow();
  });

  // 3.
  it('useIsolation=true + runId missing → throws WORKTREE_ISOLATION_MISSING_RUN_ID', async () => {
    await expect(
      computeIsolatedCwd({ worktreeRoot: workRoot, runId: undefined, useIsolation: true }),
    ).rejects.toThrow(/WORKTREE_ISOLATION_MISSING_RUN_ID/);

    await expect(
      computeIsolatedCwd({ worktreeRoot: workRoot, runId: '', useIsolation: true }),
    ).rejects.toThrow(/WORKTREE_ISOLATION_MISSING_RUN_ID/);
  });

  // 4.
  it('is idempotent — calling twice with same runId reuses existing dir', async () => {
    const runId = 'stable-run';
    const first = await computeIsolatedCwd({ worktreeRoot: workRoot, runId, useIsolation: true });
    const second = await computeIsolatedCwd({ worktreeRoot: workRoot, runId, useIsolation: true });

    expect(first.cwd).toBe(second.cwd);
    const s = await stat(second.cwd);
    expect(s.isDirectory()).toBe(true);
  });

  // 5.
  it('resolves relative worktreeRoot via path.resolve', async () => {
    const result = await computeIsolatedCwd({
      worktreeRoot: '.',
      runId: 'r-rel',
      useIsolation: true,
    });

    // Absolute path starting from resolve('.') = process.cwd()
    expect(result.cwd.startsWith(resolve('.'))).toBe(true);
    expect(result.cwd.endsWith(join('.phase-p-runs', 'r-rel'))).toBe(true);

    // Cleanup this repo-relative artifact so it doesn't pollute the tree
    await rm(resolve('.', '.phase-p-runs', 'r-rel'), { recursive: true, force: true });
  });

  // 6.
  it('distinct runIds produce distinct directories', async () => {
    const a = await computeIsolatedCwd({ worktreeRoot: workRoot, runId: 'r1', useIsolation: true });
    const b = await computeIsolatedCwd({ worktreeRoot: workRoot, runId: 'r2', useIsolation: true });

    expect(a.cwd).not.toBe(b.cwd);
    expect((await stat(a.cwd)).isDirectory()).toBe(true);
    expect((await stat(b.cwd)).isDirectory()).toBe(true);
  });
});
