import type { ShellNodeSpec } from '@/lib/adpl/types/nodes/shell';
import type { NodeAdapter, ExecutionContext, ExecutionOptions, ValidationResult } from '../types';
import type { NodeOutput } from '@/lib/adpl/types';
import { validateShellCommand, ShellPolicyError } from './policy';
import { buildShellEnv } from './env-builder';
import { buildStdin } from './stdin-injector';
import { runSpawn } from './spawner';
import { parseOutput } from './output-parser';

export const shellAdapter: NodeAdapter<ShellNodeSpec> = {
  type: 'shell',

  defaultTimeout(): number {
    return 30;
  },

  validate(spec: ShellNodeSpec): ValidationResult {
    return validateShellCommand(spec, { worktreeRoot: '/' } as ExecutionContext);
  },

  async execute(
    spec: ShellNodeSpec,
    ctx: ExecutionContext,
    options: ExecutionOptions,
  ): Promise<NodeOutput> {
    const policyResult = validateShellCommand(spec, ctx);
    if (!policyResult.valid) {
      const msgs = policyResult.errors?.map((e) => e.message) ?? ['Command blocked by policy'];
      throw new ShellPolicyError(msgs.join('; '), msgs);
    }

    const startMs = Date.now();
    const env = buildShellEnv(spec, ctx);
    const stdin = buildStdin(spec);

    const spawnResult = await runSpawn(spec, { env, stdin, ctx, options });
    const durationMs = Date.now() - startMs;

    if (spawnResult.timedOut) {
      return {
        status: 'failure',
        error: {
          code: 'timeout',
          message: `Shell command timed out after ${spec.timeout ?? 30}s`,
          category: 'timeout',
        },
        data: {
          stdout: null,
          stderr: spawnResult.stderr.toString('utf-8'),
          exitCode: spawnResult.exitCode,
          outputTruncated: spawnResult.outputTruncated,
        },
        metrics: { durationMs, outputTruncated: spawnResult.outputTruncated },
      };
    }

    const parsed = parseOutput(spawnResult.stdout, spec.outputFormat ?? 'auto');
    const allowedCodes = spec.allowExitCodes ?? [];
    const failOnNonZero = spec.failOnNonZero ?? true;
    const isSuccess =
      spawnResult.exitCode === 0 || allowedCodes.includes(spawnResult.exitCode);
    const ok = isSuccess || !failOnNonZero;

    const data = {
      stdout: parsed,
      stderr: spawnResult.stderr.toString('utf-8'),
      exitCode: spawnResult.exitCode,
      outputTruncated: spawnResult.outputTruncated,
    };
    const metrics = { durationMs, outputTruncated: spawnResult.outputTruncated };

    if (!ok) {
      return {
        status: 'failure',
        error: {
          code: `exit_${spawnResult.exitCode}`,
          message: `Shell command exited with code ${spawnResult.exitCode}`,
          category: 'persistent',
          details: { stderr: data.stderr },
        },
        data,
        metrics,
      };
    }

    return { status: 'success', data, metrics };
  },
};
