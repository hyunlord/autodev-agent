import type { ShellNodeSpec } from '@/lib/adpl/types/nodes/shell';
import type { ExecutionContext } from '../types';

/**
 * Builds process env for shell spawn.
 *
 * `effectiveCwd` (Stage 6 F4) overrides `AUTODEV_WORKTREE`. Shell commands that
 * reference `$AUTODEV_WORKTREE/...` therefore resolve inside the per-run isolation
 * namespace when active. Falls back to `ctx.worktreeRoot` for legacy callers.
 */
export function buildShellEnv(
  spec: ShellNodeSpec,
  ctx: ExecutionContext,
  effectiveCwd?: string,
): Record<string, string> {
  const taskAny = ctx.$task as unknown as Record<string, unknown>;
  const autodevVars: Record<string, string> = {
    AUTODEV_RUN_ID:
      (taskAny?.pipelineVersionId as string) ??
      (taskAny?.id as string) ??
      '',
    AUTODEV_NODE_ID: spec.id,
    AUTODEV_PROJECT_ID: ctx.$project?.id ?? '',
    AUTODEV_WORKTREE: effectiveCwd ?? ctx.worktreeRoot,
  };

  return {
    ...(process.env as Record<string, string>),
    ...autodevVars,
    ...(spec.env ?? {}),
  };
}
