import type { EmitFn } from './pipeline-types';
import type { PipelineEvent } from '../lib/types';

export interface WorktreeContext {
  worktreePath: string;
  branchName: string;
  originalDir: string;
}

/**
 * Check if a directory is a git repository.
 */
export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const { getExeca } = await import('../lib/execa');
    const execa = await getExeca();
    const { exitCode } = await execa('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir, reject: false, timeout: 5_000,
    }) as { exitCode: number };
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * J1: Create a git worktree for isolated coding execution.
 * Agent runs in a separate worktree so the main branch is protected.
 */
export async function createCodingWorktree(
  projectDir: string,
  taskId: string,
  emit: EmitFn,
): Promise<WorktreeContext | null> {
  if (!(await isGitRepo(projectDir))) {
    emit({ type: 'log', level: 'info',
      message: '[Worktree] Not a git repo — running in-place' } as PipelineEvent);
    return null;
  }

  const { getExeca } = await import('../lib/execa');
  const execa = await getExeca();
  const { join } = await import('path');
  const { mkdirSync } = await import('fs');

  const suffix = taskId.slice(0, 8);
  const branchName = `autodev-wt-${suffix}-${Date.now()}`;
  const worktreePath = join(projectDir, '.autodev', 'worktrees', suffix);

  try {
    mkdirSync(join(projectDir, '.autodev', 'worktrees'), { recursive: true });

    // Clean up stale worktree at same path if exists
    await execa('git', ['worktree', 'remove', worktreePath, '--force'], {
      cwd: projectDir, timeout: 10_000, reject: false,
    });

    await execa('git', ['worktree', 'add', '-b', branchName, worktreePath], {
      cwd: projectDir, timeout: 30_000,
    });

    emit({ type: 'log', level: 'info',
      message: `[Worktree] Created: ${worktreePath} (branch: ${branchName})` } as PipelineEvent);

    return { worktreePath, branchName, originalDir: projectDir };
  } catch (err) {
    emit({ type: 'log', level: 'warn',
      message: `[Worktree] Creation failed — running in-place: ${err}` } as PipelineEvent);
    return null;
  }
}

/**
 * J1: Merge worktree changes back to the original branch.
 */
export async function mergeWorktree(
  ctx: WorktreeContext,
  emit: EmitFn,
): Promise<boolean> {
  const { getExeca } = await import('../lib/execa');
  const execa = await getExeca();

  try {
    // Check if there are changes in the worktree
    const { stdout: diffStat } = await execa(
      'git', ['diff', '--stat', 'HEAD'],
      { cwd: ctx.worktreePath, reject: false, timeout: 10_000 },
    ) as { stdout: string };

    // Also check untracked files
    const { stdout: untrackedRaw } = await execa(
      'git', ['ls-files', '--others', '--exclude-standard'],
      { cwd: ctx.worktreePath, reject: false, timeout: 10_000 },
    ) as { stdout: string };

    const hasChanges = diffStat.trim().length > 0 || untrackedRaw.trim().length > 0;
    if (!hasChanges) {
      emit({ type: 'log', level: 'info',
        message: '[Worktree] No changes to merge' } as PipelineEvent);
      return true;
    }

    // Commit all changes in worktree
    await execa('git', ['add', '-A'], {
      cwd: ctx.worktreePath, reject: false, timeout: 10_000,
    });
    await execa('git', ['commit', '-m', 'autodev: coding result'], {
      cwd: ctx.worktreePath, reject: false, timeout: 10_000,
    });

    // Merge worktree branch into original
    const { exitCode } = await execa(
      'git', ['merge', ctx.branchName, '--no-ff', '-m', `autodev: merge ${ctx.branchName}`],
      { cwd: ctx.originalDir, reject: false, timeout: 30_000 },
    ) as { exitCode: number };

    if (exitCode !== 0) {
      emit({ type: 'log', level: 'warn',
        message: '[Worktree] Merge conflict — applying changes via checkout' } as PipelineEvent);
      await execa('git', ['merge', '--abort'], {
        cwd: ctx.originalDir, reject: false, timeout: 5_000,
      });
      // Checkout the branch content directly
      await execa('git', ['checkout', ctx.branchName, '--', '.'], {
        cwd: ctx.originalDir, reject: false, timeout: 10_000,
      });
      await execa('git', ['add', '-A'], {
        cwd: ctx.originalDir, reject: false, timeout: 5_000,
      });
      await execa('git', ['commit', '-m', `autodev: apply ${ctx.branchName}`], {
        cwd: ctx.originalDir, reject: false, timeout: 10_000,
      });
    }

    emit({ type: 'log', level: 'info',
      message: '[Worktree] Changes merged successfully' } as PipelineEvent);
    return true;
  } catch (err) {
    emit({ type: 'log', level: 'error',
      message: `[Worktree] Merge failed: ${err}` } as PipelineEvent);
    return false;
  }
}

/**
 * J1: Clean up a worktree (remove directory + delete branch).
 */
export async function cleanupWorktree(
  ctx: WorktreeContext,
  emit: EmitFn,
): Promise<void> {
  const { getExeca } = await import('../lib/execa');
  const execa = await getExeca();

  try {
    await execa('git', ['worktree', 'remove', ctx.worktreePath, '--force'], {
      cwd: ctx.originalDir, timeout: 15_000, reject: false,
    });
    await execa('git', ['branch', '-D', ctx.branchName], {
      cwd: ctx.originalDir, timeout: 5_000, reject: false,
    });
    emit({ type: 'log', level: 'info',
      message: '[Worktree] Cleaned up' } as PipelineEvent);
  } catch {
    // Best effort cleanup
  }
}
