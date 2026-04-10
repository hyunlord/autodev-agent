import { join } from 'path';
import { PluginRegistry } from '../lib/plugins/registry';
import { selectAgent, type CostPreference } from '../lib/agent-selector';
import { getExeca } from '../lib/execa';
import type { SubTask } from './planning';
import type { EmitFn } from './pipeline-types';
import type { PipelineEvent } from '../lib/types';

// ─── J1: Git Worktree helpers ────────────────────────────────

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const execa = await getExeca();
    const result = await execa('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir, reject: false, timeout: 5_000,
    } as any);
    return (result as any).exitCode === 0;
  } catch { return false; }
}

async function createWorktree(projectDir: string, subTaskId: string): Promise<string> {
  const execa = await getExeca();
  const branchName = `autodev-subtask-${subTaskId}`;
  const worktreePath = join(projectDir, '.autodev', 'worktrees', subTaskId);
  await execa('git', ['worktree', 'add', '-b', branchName, worktreePath], {
    cwd: projectDir, timeout: 30_000,
  });
  return worktreePath;
}

async function removeWorktree(projectDir: string, worktreePath: string, branchName: string): Promise<void> {
  const execa = await getExeca();
  try {
    await execa('git', ['worktree', 'remove', worktreePath, '--force'], {
      cwd: projectDir, timeout: 15_000,
    });
    await execa('git', ['branch', '-D', branchName], {
      cwd: projectDir, timeout: 5_000, reject: false,
    } as any);
  } catch { /* cleanup best effort */ }
}

async function mergeWorktreeChanges(projectDir: string, branchName: string): Promise<string[]> {
  const execa = await getExeca();
  const { stdout: diffOutput } = await execa('git', ['diff', '--name-only', 'HEAD', branchName], {
    cwd: projectDir, timeout: 10_000,
  });
  const modifiedFiles = diffOutput.trim().split('\n').filter(Boolean);
  if (modifiedFiles.length > 0) {
    await execa('git', ['merge', branchName, '--no-edit', '--no-ff', '-m', `autodev: merge subtask ${branchName}`], {
      cwd: projectDir, timeout: 30_000,
    });
  }
  return modifiedFiles;
}

// ─── J4: Diff Gate ───────────────────────────────────────────

async function validateDiffGate(
  workDir: string,
  allowedFiles: string[],
  subTaskId: string,
  emit: EmitFn,
): Promise<{ passed: boolean; violations: string[] }> {
  const execa = await getExeca();
  const { stdout } = await execa('git', ['diff', '--name-only', 'HEAD'], {
    cwd: workDir, timeout: 10_000,
  });
  const changedFiles = stdout.trim().split('\n').filter(Boolean);

  const allowedPatterns = [
    ...allowedFiles,
    'package-lock.json',
    'pnpm-lock.yaml',
    'node_modules/**',
    '.autodev/**',
  ];

  const violations = changedFiles.filter(file =>
    !allowedPatterns.some(pattern => {
      if (pattern.includes('*')) return file.startsWith(pattern.replace('/**', ''));
      return file === pattern;
    }),
  );

  if (violations.length > 0) {
    emit({
      type: 'log', level: 'warn',
      message: `[DiffGate:${subTaskId}] ${violations.length} file(s) outside scope: ${violations.join(', ')}`,
    } as PipelineEvent);
  }

  return { passed: violations.length === 0, violations };
}

export interface ParallelResult {
  subTaskId: string;
  success: boolean;
  modifiedFiles: string[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  text: string;
  agentId: string;
  durationMs: number;
}

/**
 * 병렬로 여러 sub-task 실행.
 * 독립 sub-task는 Promise.all로 동시 실행, dependsOn이 있는 sub-task는
 * 의존 sub-task 완료 후 순차 실행.
 */
export async function executeParallelCoding(params: {
  subTasks: SubTask[];
  projectDir: string;
  systemPrompt: string | null;
  workspaceContext: string;
  emit: EmitFn;
  signal?: AbortSignal;
  costPreference?: CostPreference;
}): Promise<ParallelResult[]> {
  const { subTasks, projectDir, systemPrompt, workspaceContext, emit, signal, costPreference } = params;

  const independent = subTasks.filter((t) => !t.dependsOn || t.dependsOn.length === 0);
  const dependent = subTasks.filter((t) => t.dependsOn && t.dependsOn.length > 0);

  emit({
    type: 'log',
    level: 'info',
    message: `[Parallel] ${independent.length} independent + ${dependent.length} dependent sub-tasks`,
  } as PipelineEvent);

  const results: ParallelResult[] = [];

  // Phase 1: 독립 sub-task 병렬 실행
  if (independent.length > 0) {
    emit({
      type: 'log',
      level: 'info',
      message: `[Parallel] Starting ${independent.length} sub-tasks in parallel...`,
    } as PipelineEvent);

    const parallelResults = await Promise.all(
      independent.map((subTask) =>
        executeSubTask(subTask, projectDir, systemPrompt, workspaceContext, emit, signal, costPreference),
      ),
    );
    results.push(...parallelResults);
  }

  // Phase 2: 의존 sub-task 순차 실행
  for (const subTask of dependent) {
    if (signal?.aborted) {
      emit({
        type: 'log',
        level: 'warn',
        message: `[Parallel] Aborted before running ${subTask.id}`,
      } as PipelineEvent);
      results.push({
        subTaskId: subTask.id,
        success: false,
        modifiedFiles: [],
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        text: 'Aborted before execution',
        agentId: '',
        durationMs: 0,
      });
      continue;
    }

    const depResults = results.filter((r) => subTask.dependsOn?.includes(r.subTaskId));
    const allDepsSuccess = depResults.length > 0 && depResults.every((r) => r.success);
    const missingDeps = (subTask.dependsOn ?? []).filter(
      (id) => !results.some((r) => r.subTaskId === id),
    );

    if (!allDepsSuccess || missingDeps.length > 0) {
      const reason = missingDeps.length > 0
        ? `missing dependencies: ${missingDeps.join(', ')}`
        : `dependency failed`;
      emit({
        type: 'log',
        level: 'warn',
        message: `[Parallel] Skipping ${subTask.id}: ${reason}`,
      } as PipelineEvent);
      results.push({
        subTaskId: subTask.id,
        success: false,
        modifiedFiles: [],
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        text: `Skipped: ${reason}`,
        agentId: '',
        durationMs: 0,
      });
      continue;
    }

    const result = await executeSubTask(
      subTask,
      projectDir,
      systemPrompt,
      workspaceContext,
      emit,
      signal,
      costPreference,
    );
    results.push(result);
  }

  return results;
}

async function executeSubTask(
  subTask: SubTask,
  projectDir: string,
  systemPrompt: string | null,
  workspaceContext: string,
  emit: EmitFn,
  signal?: AbortSignal,
  costPreference?: CostPreference,
): Promise<ParallelResult> {
  const startTime = Date.now();

  // 에이전트 선택: subTask.agent 지정 시 해당 사용, 아니면 기본 fallback 순서
  const selection = await selectAgent(subTask.agent ?? null, null, costPreference);
  const agent = selection.agent;
  const agentId = selection.agentId;

  if (!agent) {
    return {
      subTaskId: subTask.id,
      success: false,
      modifiedFiles: [],
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      text: `No available agent (requested: ${subTask.agent ?? 'auto'})`,
      agentId: subTask.agent ?? 'unknown',
      durationMs: Date.now() - startTime,
    };
  }

  // ─── J1: Worktree isolation ──────────────────────────
  let workDir = projectDir;
  let branchName = `autodev-subtask-${subTask.id}`;
  const useWorktree = await isGitRepo(projectDir);

  if (useWorktree) {
    try {
      workDir = await createWorktree(projectDir, subTask.id);
      emit({ type: 'log', level: 'info',
        message: `[Parallel:${subTask.id}] Worktree created: ${workDir}` } as PipelineEvent);
    } catch {
      emit({ type: 'log', level: 'warn',
        message: `[Parallel:${subTask.id}] Worktree failed, using shared dir` } as PipelineEvent);
      workDir = projectDir;
    }
  }

  emit({
    type: 'log',
    level: 'info',
    message: `[Parallel:${subTask.id}] Starting with ${agent.name} — files: ${subTask.files.join(', ')}`,
  } as PipelineEvent);

  const filesScope = subTask.files.length > 0
    ? `IMPORTANT: You are responsible ONLY for these files: ${subTask.files.join(', ')}\nDo NOT modify files outside your assigned scope.\n\n`
    : '';

  const prompt = `${systemPrompt ? systemPrompt + '\n\n' : ''}CRITICAL: You MUST only create and modify files inside ${workDir}.
${filesScope}${subTask.codingPrompt}

${workspaceContext}`;

  try {
    const result = await agent.invoke({
      task: prompt,
      projectDir: workDir,
      maxTurns: 15,
      timeoutMs: 300_000,
      onProgress: (event: PipelineEvent) => {
        // sub-task id를 메시지에 prefix로 표시 (interleaved 로그 구분)
        const tagged: PipelineEvent = (event as any).message
          ? ({ ...event, message: `[${subTask.id}] ${(event as any).message}` } as PipelineEvent)
          : event;
        emit(tagged);
      },
    });

    emit({
      type: 'log',
      level: 'info',
      message: `[Parallel:${subTask.id}] Done — ${result.modifiedFiles.length} files, $${(result.costUsd ?? 0).toFixed(4)} (${agent.name})`,
    } as PipelineEvent);

    // ─── J4: Diff Gate — validate file scope ─────────
    if (workDir !== projectDir) {
      const diffGate = await validateDiffGate(workDir, subTask.files, subTask.id, emit);
      if (!diffGate.passed) {
        emit({ type: 'log', level: 'warn',
          message: `[DiffGate:${subTask.id}] Unexpected files: ${diffGate.violations.join(', ')}. Proceeding with caution.`,
        } as PipelineEvent);
      }

      // Merge worktree changes back to main branch
      try {
        const mergedFiles = await mergeWorktreeChanges(projectDir, branchName);
        emit({ type: 'log', level: 'info',
          message: `[Parallel:${subTask.id}] Merged ${mergedFiles.length} files from worktree`,
        } as PipelineEvent);
      } catch (mergeErr) {
        emit({ type: 'log', level: 'warn',
          message: `[Parallel:${subTask.id}] Merge failed: ${mergeErr}`,
        } as PipelineEvent);
      }
    }

    return {
      subTaskId: subTask.id,
      success: result.success,
      modifiedFiles: result.modifiedFiles,
      costUsd: result.costUsd ?? 0,
      inputTokens: result.tokenUsage?.inputTokens ?? 0,
      outputTokens: result.tokenUsage?.outputTokens ?? 0,
      text: result.text,
      agentId,
      durationMs: result.durationMs ?? Date.now() - startTime,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    emit({
      type: 'log',
      level: 'warn',
      message: `[Parallel:${subTask.id}] Error: ${errMsg}`,
    } as PipelineEvent);
    return {
      subTaskId: subTask.id,
      success: false,
      modifiedFiles: [],
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      text: `Error: ${errMsg}`,
      agentId,
      durationMs: Date.now() - startTime,
    };
  } finally {
    // J1: Worktree cleanup (best effort)
    if (workDir !== projectDir) {
      await removeWorktree(projectDir, workDir, branchName).catch(() => {});
    }
    void PluginRegistry; // eslint silencer
  }
}
