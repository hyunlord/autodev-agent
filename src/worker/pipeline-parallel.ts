import { join } from 'path';
import { PluginRegistry } from '../lib/plugins/registry';
import { selectAgent, type CostPreference } from '../lib/agent-selector';
import { getExeca } from '../lib/execa';
import type { SubTask } from './planning';
import type { EmitFn } from './pipeline-types';
import type { PipelineEvent } from '../lib/types';
import type { HookEngine } from '../lib/hooks/hook-engine';

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

async function mergeWorktreeChanges(projectDir: string, worktreePath: string, branchName: string): Promise<string[]> {
  const execa = await getExeca();

  // Check for uncommitted changes (staged, unstaged, untracked) in the worktree
  const statusResult = await execa('git', ['status', '--porcelain'], {
    cwd: worktreePath, reject: false, timeout: 10_000,
  } as any);
  const statusOut = (statusResult as any).stdout ?? '';
  if (statusOut.trim().length > 0) {
    // Commit all changes in the worktree so they appear on the branch
    await execa('git', ['add', '-A'], { cwd: worktreePath, reject: false, timeout: 10_000 } as any);
    await execa('git', ['commit', '-m', `autodev: subtask ${branchName}`], {
      cwd: worktreePath, reject: false, timeout: 10_000,
    } as any);
  }

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

// ─── J5: DAG topological sort ────────────────────────────────

/**
 * Kahn's algorithm — SubTask[]를 DAG 레벨로 분할.
 * 같은 레벨의 task는 동시 실행 가능 (Promise.all).
 */
export function topologicalLevels(subTasks: SubTask[]): SubTask[][] {
  const taskMap = new Map(subTasks.map(t => [t.id, t]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const t of subTasks) {
    inDegree.set(t.id, 0);
    dependents.set(t.id, []);
  }

  for (const t of subTasks) {
    for (const depId of t.dependsOn ?? []) {
      if (taskMap.has(depId)) {
        inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
        dependents.get(depId)!.push(t.id);
      }
    }
  }

  const levels: SubTask[][] = [];
  let queue = subTasks.filter(t => (inDegree.get(t.id) ?? 0) === 0);

  while (queue.length > 0) {
    levels.push(queue);
    const nextQueue: SubTask[] = [];
    for (const t of queue) {
      for (const childId of dependents.get(t.id) ?? []) {
        const newDeg = (inDegree.get(childId) ?? 1) - 1;
        inDegree.set(childId, newDeg);
        if (newDeg === 0) {
          nextQueue.push(taskMap.get(childId)!);
        }
      }
    }
    queue = nextQueue;
  }

  // Cycle detection: append orphaned tasks to final level
  const placed = new Set(levels.flat().map(t => t.id));
  const remaining = subTasks.filter(t => !placed.has(t.id));
  if (remaining.length > 0) {
    levels.push(remaining);
  }

  return levels;
}

/** DAG의 critical path 길이 (= 레벨 수) */
export function criticalPathLength(subTasks: SubTask[]): number {
  return topologicalLevels(subTasks).length;
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
 * DAG 기반 병렬 sub-task 실행.
 * topologicalLevels()로 레벨 분할 → 같은 레벨은 Promise.all 동시 실행.
 */
export async function executeParallelCoding(params: {
  subTasks: SubTask[];
  projectDir: string;
  systemPrompt: string | null;
  workspaceContext: string;
  emit: EmitFn;
  signal?: AbortSignal;
  costPreference?: CostPreference;
  hookEngine?: HookEngine;
  taskId?: string;
  taskAgentId?: string;
}): Promise<ParallelResult[]> {
  const { subTasks, projectDir, systemPrompt, workspaceContext, emit, signal, costPreference, hookEngine, taskId, taskAgentId } = params;

  const levels = topologicalLevels(subTasks);

  emit({
    type: 'log',
    level: 'info',
    message: `[Parallel] DAG: ${levels.length} level(s), ${subTasks.length} sub-task(s), critical path: ${levels.length}`,
  } as PipelineEvent);

  const results: ParallelResult[] = [];
  const completedIds = new Map<string, boolean>();

  for (let lvl = 0; lvl < levels.length; lvl++) {
    const level = levels[lvl];

    if (signal?.aborted) {
      for (const t of level) {
        results.push({
          subTaskId: t.id, success: false, modifiedFiles: [], costUsd: 0,
          inputTokens: 0, outputTokens: 0, text: 'Aborted', agentId: '', durationMs: 0,
        });
        completedIds.set(t.id, false);
      }
      continue;
    }

    // 의존성 실패한 task 필터
    const runnable: SubTask[] = [];
    for (const t of level) {
      const deps = t.dependsOn ?? [];
      const failedDeps = deps.filter(id => completedIds.has(id) && !completedIds.get(id));
      const missingDeps = deps.filter(id => !completedIds.has(id));

      if (failedDeps.length > 0 || missingDeps.length > 0) {
        const reason = failedDeps.length > 0
          ? `dependency failed: ${failedDeps.join(', ')}`
          : `missing dependencies: ${missingDeps.join(', ')}`;
        emit({ type: 'log', level: 'warn',
          message: `[Parallel] Skipping ${t.id}: ${reason}` } as PipelineEvent);
        results.push({
          subTaskId: t.id, success: false, modifiedFiles: [], costUsd: 0,
          inputTokens: 0, outputTokens: 0, text: `Skipped: ${reason}`, agentId: '', durationMs: 0,
        });
        completedIds.set(t.id, false);
        continue;
      }
      runnable.push(t);
    }

    if (runnable.length === 0) continue;

    emit({
      type: 'log',
      level: 'info',
      message: `[Parallel] Level ${lvl + 1}/${levels.length}: ${runnable.length} task(s) in parallel`,
    } as PipelineEvent);

    const levelResults = await Promise.all(
      runnable.map(t =>
        executeSubTask(t, projectDir, systemPrompt, workspaceContext, emit, signal, costPreference, hookEngine, taskId, taskAgentId),
      ),
    );

    for (const r of levelResults) {
      results.push(r);
      completedIds.set(r.subTaskId, r.success);
    }
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
  hookEngine?: HookEngine,
  taskId?: string,
  taskAgentId?: string,
): Promise<ParallelResult> {
  const startTime = Date.now();

  // 에이전트 선택: task-level agentId 우선, 없으면 subTask.agent, 최종 fallback
  const preferredAgent = taskAgentId ?? subTask.agent ?? null;
  const selection = await selectAgent(preferredAgent, null, costPreference);
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

  // K9: SubTaskStart hook
  if (hookEngine && taskId) {
    hookEngine.execute({
      event: 'SubTaskStart', taskId, projectDir, subTaskId: subTask.id,
    }, emit).catch(() => {});
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
        const mergedFiles = await mergeWorktreeChanges(projectDir, workDir, branchName);
        emit({ type: 'log', level: 'info',
          message: `[Parallel:${subTask.id}] Merged ${mergedFiles.length} files from worktree`,
        } as PipelineEvent);
      } catch (mergeErr) {
        emit({ type: 'log', level: 'warn',
          message: `[Parallel:${subTask.id}] Merge failed: ${mergeErr}`,
        } as PipelineEvent);
      }
    }

    // K9: SubTaskComplete hook
    if (hookEngine && taskId) {
      hookEngine.execute({
        event: 'SubTaskComplete', taskId, projectDir, subTaskId: subTask.id,
        success: result.success,
      }, emit).catch(() => {});
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
    // K9: SubTaskComplete hook (error path)
    if (hookEngine && taskId) {
      hookEngine.execute({
        event: 'SubTaskComplete', taskId, projectDir, subTaskId: subTask.id,
        success: false,
      }, emit).catch(() => {});
    }
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
