import type { ShellNodeSpec } from '@/lib/adpl/types/nodes/shell';
import type { ExecutionContext } from '../types';

export function buildShellEnv(
  spec: ShellNodeSpec,
  ctx: ExecutionContext,
): Record<string, string> {
  const taskAny = ctx.$task as unknown as Record<string, unknown>;
  const autodevVars: Record<string, string> = {
    AUTODEV_RUN_ID:
      (taskAny?.pipelineVersionId as string) ??
      (taskAny?.id as string) ??
      '',
    AUTODEV_NODE_ID: spec.id,
    AUTODEV_PROJECT_ID: ctx.$project?.id ?? '',
    AUTODEV_WORKTREE: ctx.worktreeRoot,
  };

  return {
    ...(process.env as Record<string, string>),
    ...autodevVars,
    ...(spec.env ?? {}),
  };
}
