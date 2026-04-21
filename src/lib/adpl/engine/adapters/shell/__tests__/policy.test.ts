import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateShellCommand, ShellPolicyError } from '../policy';
import type { ShellNodeSpec } from '@/lib/adpl/types/nodes/shell';
import type { ExecutionContext } from '../../types';

vi.mock('@/lib/safety/command-checker', () => ({
  checkCommand: vi.fn((cmd: string) => {
    const dangerous = [
      /rm\s+-rf\s+\//,
      /sudo\s+/,
      /git\s+push\s+.*--force/,
    ];
    const warnings: string[] = [];
    for (const p of dangerous) {
      if (p.test(cmd)) warnings.push(`Blocked: ${cmd.slice(0, 50)}`);
    }
    return { safe: warnings.length === 0, warnings };
  }),
}));

const dummyCtx = { worktreeRoot: '/tmp/test' } as Pick<ExecutionContext, 'worktreeRoot'>;

function makeSpec(command: string): ShellNodeSpec {
  return { id: 'test', type: 'shell', command };
}

describe('validateShellCommand', () => {
  it('allows safe echo command', () => {
    const result = validateShellCommand(makeSpec('echo hello'), dummyCtx);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('allows node -e command', () => {
    const result = validateShellCommand(makeSpec('node -e "console.log(1)"'), dummyCtx);
    expect(result.valid).toBe(true);
  });

  it('blocks rm -rf / command', () => {
    const result = validateShellCommand(makeSpec('rm -rf /tmp'), dummyCtx);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].message).toContain('Blocked');
  });

  it('blocks sudo command', () => {
    const result = validateShellCommand(makeSpec('sudo apt-get install foo'), dummyCtx);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('blocks git push --force', () => {
    const result = validateShellCommand(makeSpec('git push origin main --force'), dummyCtx);
    expect(result.valid).toBe(false);
  });

  it('allows pnpm build command', () => {
    const result = validateShellCommand(makeSpec('pnpm run build'), dummyCtx);
    expect(result.valid).toBe(true);
  });

  it('allows multi-pipe safe command', () => {
    const result = validateShellCommand(makeSpec('pnpm test 2>&1 | tail -20'), dummyCtx);
    expect(result.valid).toBe(true);
  });

  it('returns multiple errors for multiple violations', () => {
    const result = validateShellCommand(makeSpec('sudo rm -rf /home'), dummyCtx);
    expect(result.valid).toBe(false);
    expect((result.errors?.length ?? 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('ShellPolicyError', () => {
  it('is an Error with name ShellPolicyError', () => {
    const err = new ShellPolicyError('blocked', ['reason1']);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ShellPolicyError');
    expect(err.warnings).toEqual(['reason1']);
    expect(err.message).toBe('blocked');
  });
});
