import type { ShellNodeSpec } from '@/lib/adpl/types/nodes/shell';
import type { NodeAdapter, ExecutionContext, ExecutionOptions, ValidationResult } from '../types';
import type { NodeOutput } from '@/lib/adpl/types';
import type { ShellOutputEvent, WorktreeIsolatedEvent } from '../../events/types';
import { validateShellCommand, ShellPolicyError } from './policy';
import { buildShellEnv } from './env-builder';
import { parseOutput, MAX_OUTPUT_BYTES } from './output-parser';
import { spawnWithKillGroup } from '../../utils/spawn-with-kill-group';
import { computeIsolatedCwd } from './isolation';

const DEFAULT_TIMEOUT_MS = 30_000;

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
    const taskAny = ctx.$task as unknown as Record<string, unknown>;
    // Prefer explicit runId from ExecutionContext (injected by context-builder in F4).
    // Fallback to $task.id for tests that construct ExecutionContext inline without runId.
    const runId = ctx.runId ?? ((taskAny?.id as string) ?? 'unknown');
    const nodeId = spec.id;

    // Stage 6 F4 — Worktree isolation. Skip when:
    //   - user opts out via spec.useIsolatedWorktree === false
    //   - user explicitly set spec.cwd (user intent wins)
    //   - ExecutionContext has no runId (standalone/test contexts without context-builder)
    const useIsolation =
      spec.useIsolatedWorktree !== false && !spec.cwd && !!ctx.runId;
    const isolation = await computeIsolatedCwd({
      worktreeRoot: ctx.worktreeRoot,
      runId: ctx.runId,
      useIsolation,
    });

    if (isolation.isolated && isolation.isolatedPath) {
      options.eventBus.emit({
        type: 'worktree.isolated',
        timestamp: new Date(),
        runId,
        nodeId,
        isolatedPath: isolation.isolatedPath,
      } as WorktreeIsolatedEvent);
    }

    const cwd = spec.cwd ?? isolation.cwd;
    const env = buildShellEnv(spec, ctx, cwd);
    const timeoutMs = spec.timeout != null ? spec.timeout * 1000 : DEFAULT_TIMEOUT_MS;
    const isShellMode = (spec.mode ?? 'shell') === 'shell';

    let spawnResult: Awaited<ReturnType<typeof spawnWithKillGroup>>;
    try {
      spawnResult = await spawnWithKillGroup({
        command: spec.command,
        args: isShellMode ? [] : (spec.args ?? []),
        cwd,
        env: env as NodeJS.ProcessEnv,
        stdin: spec.stdin,
        timeoutMs,
        signal: options.cancellationToken.signal,
        shell: isShellMode,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        onStdout: (chunk) => options.eventBus.emit({
          type: 'shell.output',
          timestamp: new Date(),
          runId,
          nodeId,
          stream: 'stdout',
          chunk: chunk.toString('utf-8'),
        } as ShellOutputEvent),
        onStderr: (chunk) => options.eventBus.emit({
          type: 'shell.output',
          timestamp: new Date(),
          runId,
          nodeId,
          stream: 'stderr',
          chunk: chunk.toString('utf-8'),
        } as ShellOutputEvent),
      });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.startsWith('SPAWN_TIMEOUT')) {
        return {
          status: 'failure',
          error: {
            code: 'timeout',
            message: `Shell command timed out after ${spec.timeout ?? 30}s`,
            category: 'timeout',
          },
          data: {
            stdout: null,
            stderr: '',
            exitCode: 124,
            outputTruncated: false,
          },
          metrics: { durationMs, outputTruncated: false },
        };
      }

      if (msg.startsWith('SPAWN_ABORTED')) {
        return {
          status: 'failure',
          error: {
            code: 'cancelled',
            message: 'Shell command was cancelled',
            category: 'cancellation',
          },
          data: {
            stdout: null,
            stderr: '',
            exitCode: 130,
            outputTruncated: false,
          },
          metrics: { durationMs, outputTruncated: false },
        };
      }

      throw err;
    }

    const durationMs = Date.now() - startMs;
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
      outputTruncated: spawnResult.truncated,
    };
    const metrics = { durationMs, outputTruncated: spawnResult.truncated };

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
