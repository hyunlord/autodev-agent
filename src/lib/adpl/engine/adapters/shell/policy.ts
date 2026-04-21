import { checkCommand } from '@/lib/safety/command-checker';
import type { ShellNodeSpec } from '@/lib/adpl/types/nodes/shell';
import type { ExecutionContext, ValidationResult } from '../types';

export class ShellPolicyError extends Error {
  constructor(
    message: string,
    public readonly warnings: string[],
  ) {
    super(message);
    this.name = 'ShellPolicyError';
  }
}

export function validateShellCommand(
  spec: ShellNodeSpec,
  _ctx: Pick<ExecutionContext, 'worktreeRoot'>,
): ValidationResult {
  const result = checkCommand(spec.command);
  if (!result.safe) {
    return {
      valid: false,
      errors: result.warnings.map((w) => ({ message: w })),
    };
  }
  return { valid: true };
}
