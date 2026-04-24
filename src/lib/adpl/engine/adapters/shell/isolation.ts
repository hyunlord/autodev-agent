import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Stage 6 F4 — Worktree isolation utility.
 *
 * Computes per-run cwd namespace under `${worktreeRoot}/.phase-p-runs/${runId}`
 * so parallel branches / forEach parallelism > 1 cannot race on shared files.
 *
 * Scope: shell adapter only. Agent backends and legacy paths keep using the
 * project worktreeRoot as before.
 */

export interface ComputeIsolatedCwdInput {
  /** Absolute (or relative-to-CWD) path that bounds the pipeline's side effects. */
  worktreeRoot: string;
  /** The pipeline run identifier; required when `useIsolation` is true. */
  runId?: string;
  /** Master switch — false short-circuits to `{cwd: worktreeRoot, isolated: false}`. */
  useIsolation: boolean;
}

export interface IsolatedCwdResult {
  /** The effective cwd to hand to `execa`. Always an absolute, resolved path. */
  cwd: string;
  /** True iff the namespace directory was applied. */
  isolated: boolean;
  /** Present only when `isolated === true`; useful for event emission. */
  isolatedPath?: string;
}

export async function computeIsolatedCwd(
  input: ComputeIsolatedCwdInput,
): Promise<IsolatedCwdResult> {
  const root = resolve(input.worktreeRoot);

  if (!input.useIsolation) {
    return { cwd: root, isolated: false };
  }

  if (!input.runId || input.runId.length === 0) {
    throw new Error(
      `WORKTREE_ISOLATION_MISSING_RUN_ID: cannot isolate without runId (worktreeRoot=${root})`,
    );
  }

  const isolatedPath = resolve(root, '.phase-p-runs', input.runId);
  await mkdir(isolatedPath, { recursive: true });

  return { cwd: isolatedPath, isolated: true, isolatedPath };
}
