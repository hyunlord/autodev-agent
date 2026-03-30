import { db } from '../lib/db/client';
import { tasks, attempts, events, verifications } from '../lib/db/schema';
import { join, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { eq, and, not, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { detectProjectType } from '../lib/detection/project-type';
import { generatePlan } from './planning';
import { PluginRegistry } from '../lib/plugins/registry';
import { RetryController } from './retry';
import { generateEscalationReport } from './escalation';
import { loadConfig } from '../lib/config';
import type { PipelineEvent, TaskStatus, PlanningMode } from '../lib/types';
import type { ICodingAgent } from '../lib/plugins/interfaces';

type EmitFn = (event: PipelineEvent) => void;

export async function runPipeline(taskId: string, rawEmit: EmitFn): Promise<void> {
  // Wrap emit to persist all events to DB for later retrieval
  const emit: EmitFn = (event) => {
    rawEmit(event);
    try {
        db.insert(events).values({
          id: nanoid(),
          taskId,
          type: event.type,
          data: JSON.stringify(event),
          createdAt: new Date().toISOString(),
        }).run();
    } catch { /* DB write failed — non-critical */ }
  };

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) {
    emit({ type: 'log', level: 'error', message: `Task ${taskId} not found` });
    return;
  }

  const projectDir = await resolveProjectDir(taskId, task.projectDir);
  emit({ type: 'log', level: 'info', message: `Working directory: ${projectDir}` });

  // Save auto-created workspace path back to DB
  if (!task.projectDir) {
    db.update(tasks).set({
      projectDir: projectDir,
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, taskId)).run();
  }

  const config = await loadConfig(projectDir);

  // Fetch project history for context (completed tasks in same projectDir)
  const projectHistory = db
    .select({
      prompt: tasks.prompt,
      status: tasks.status,
      result: tasks.result,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectDir, projectDir),
        not(eq(tasks.id, taskId)),
        eq(tasks.status, 'completed'),
      )
    )
    .orderBy(desc(tasks.createdAt))
    .limit(10)
    .all();

  try {
    // ─── 1. Detect project type ──────────────────────────
    const projectConfig = detectProjectType(projectDir);
    updateTaskStatus(taskId, 'planning');
    emit({ type: 'status_change', status: 'planning', message: 'Analyzing project and generating plan...' });

    if (projectConfig) {
      emit({ type: 'log', level: 'info', message: `Detected project: ${projectConfig.displayName} (${projectConfig.language})` });
      db.update(tasks).set({
        projectType: projectConfig.type,
        updatedAt: new Date().toISOString(),
      }).where(eq(tasks.id, taskId)).run();
    }

    // ─── 2. Planning (runs once, no retry) ───────────────
    const taskConfig = task.config
      ? (typeof task.config === 'string' ? JSON.parse(task.config) : task.config) as Record<string, any>
      : {};

    // Scan workspace files for planner + coding agent context
    let workspaceContext = '';
    try {
      const { getExeca } = await import('../lib/execa');
      const ex = await getExeca();
      const { stdout } = await ex('find', [
        projectDir, '-maxdepth', '3',
        '-not', '-path', '*/.git/*',
        '-not', '-path', '*/node_modules/*',
        '-not', '-path', '*/.next/*',
        '-not', '-path', '*/.autodev/*',
        '-type', 'f',
      ], { reject: false, timeout: 5_000 });

      if (stdout.trim()) {
        const files = stdout.trim().split('\n')
          .map((f: string) => f.replace(projectDir + '/', '').replace(projectDir, ''))
          .filter((f: string) => f && !f.startsWith('.'));
        if (files.length > 0 && files.length <= 50) {
          workspaceContext = `\nExisting files in project:\n${files.map((f: string) => `- ${f}`).join('\n')}`;
          const { readFileSync, statSync } = await import('fs');
          for (const f of files.slice(0, 5)) {
            try {
              const fullPath = join(projectDir, f);
              const stat = statSync(fullPath);
              if (stat.size < 10_000) {
                const content = readFileSync(fullPath, 'utf-8');
                workspaceContext += `\n\nFile: ${f}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``;
              }
            } catch { /* file read failed — skip */ }
          }
        }
      }
    } catch { /* workspace scan failed — ok */ }

    const plan = await generatePlan(
      task.prompt,
      projectConfig,
      (task.planningMode ?? 'auto') as PlanningMode,
      taskConfig.codingPrompt ? {
        codingPrompt: taskConfig.codingPrompt,
        verificationChecklist: taskConfig.verificationChecklist ?? '',
      } : undefined,
      (msg) => emit({ type: 'log', level: 'info', message: msg }),
      workspaceContext,
      projectDir,
    );

    emit({ type: 'log', level: 'info', message: `Plan: ${plan.summary}` });
    emit({ type: 'log', level: 'info', message: `Estimated files: ${plan.estimatedFiles.join(', ')}` });
    emit({ type: 'log', level: 'info', message: `Coding prompt: ${plan.codingPrompt.slice(0, 500)}` });
    emit({ type: 'log', level: 'info', message: `Verification: ${plan.verificationSpec.steps.map(s => `${s.id}:${s.type}(${s.description})`).join(', ')}` });
    recordEvent(taskId, 'plan_complete', { summary: plan.summary, files: plan.estimatedFiles });

    // Validate verification spec against actual project — remove impossible checks
    if (!projectConfig?.buildCmd) {
      const hasPkgJson = existsSync(join(projectDir, 'package.json'));
      if (!hasPkgJson) {
        plan.verificationSpec.steps = plan.verificationSpec.steps.filter(s => {
          if (s.type === 'build_check') {
            emit({ type: 'log', level: 'warn', message: `Removed build_check: no package.json found` });
            return false;
          }
          if (s.type === 'port_check' || s.type === 'http_check' || s.type === 'dom_check') {
            emit({ type: 'log', level: 'warn', message: `Removed ${s.type}: no dev server for this project type` });
            return false;
          }
          return true;
        });
        if (plan.verificationSpec.steps.length === 0) {
          plan.verificationSpec.steps.push({
            id: 'v1',
            description: 'Output files exist',
            type: 'file_check',
            filePath: plan.estimatedFiles[0] ?? 'index.html',
          });
        }
      }
    }

    // ─── 3. Code → Verify retry loop ─────────────────────
    let { agent, agentId } = await selectAgent((task as any).agentId ?? 'claude-code', emit);

    const retryCtrl = new RetryController({
      maxAttempts: config.maxRetries,
      timeBudgetMs: 300_000,
      tokenBudget: 100_000,
    });

    let lastModifiedFiles: string[] = [];
    let totalCostUsd = 0;
    let lastFailedChecks: Array<{ id: string; description: string; actual?: string }> = [];

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      const isRetry = attempt > 1;
      if (isRetry) {
        updateTaskStatus(taskId, 'retrying');
        emit({ type: 'status_change', status: 'retrying', message: `Retry attempt ${attempt}/${config.maxRetries}...` });
      } else {
        updateTaskStatus(taskId, 'coding');
      }

      emit({ type: 'status_change', status: 'coding', message: isRetry ? `Retrying with error context (attempt ${attempt})...` : `Sending task to ${agent.name}...` });
      emit({ type: 'attempt_start', attemptNum: attempt, agentId });

      let codingPrompt = `CRITICAL: You MUST only create and modify files inside this directory: ${projectDir}
Do NOT navigate to or modify files outside this directory.
Do NOT search for or modify any files in parent directories.
Your working directory is ${projectDir} — all file paths must be relative to this directory.

${plan.codingPrompt}`;
      if (workspaceContext) {
        codingPrompt = codingPrompt + `\n\n${workspaceContext}`;
      }
      if (!isRetry && projectHistory.length > 0) {
        const historyContext = projectHistory.map(h => {
          try {
            const result = h.result ? (typeof h.result === 'string' ? JSON.parse(h.result) : h.result) : {};
            return `- "${h.prompt}" → ${(result as any).summary ?? 'completed'}`;
          } catch {
            return `- "${h.prompt}" → completed`;
          }
        }).join('\n');
        codingPrompt = `## Previous work on this project:\n${historyContext}\n\n## Current task:\n${codingPrompt}`;
        emit({ type: 'log', level: 'info', message: `Project history: ${projectHistory.length} previous task(s) found` });
      }
      if (isRetry && lastFailedChecks.length > 0) {
        const retryContext = retryCtrl.buildRetryContext(lastFailedChecks);
        codingPrompt = `${plan.codingPrompt}\n\n---\n\n${retryContext}`;
        emit({ type: 'log', level: 'info', message: `Retry context: ${lastFailedChecks.length} failed checks from previous attempt` });
      }

      const safePrompt = `CRITICAL: Your working directory is ${projectDir}.
ONLY modify files inside this directory.
Do NOT navigate to or modify any files outside ${projectDir}.
All paths must be relative to the current directory.\n\n${codingPrompt}`;

      const codeResult = await agent.invoke({
        task: safePrompt,
        projectDir,
        maxTurns: 20,
        timeoutMs: 300_000,
        onProgress: (event) => emit(event),
      });

      const codingAttemptId = nanoid();
      db.insert(attempts).values({
        id: codingAttemptId,
        taskId,
        attemptNum: attempt,
        agentId,
        phase: 'coding',
        status: codeResult.success ? 'success' : 'error',
        input: JSON.stringify({ codingPrompt: codingPrompt.slice(0, 5000) }),
        output: JSON.stringify({
          text: codeResult.text.slice(0, 5000),
          modifiedFiles: codeResult.modifiedFiles,
          costUsd: codeResult.costUsd,
        }),
        errorLog: codeResult.success ? null : codeResult.text.slice(0, 5000),
        errorHash: null,
        costUsd: codeResult.costUsd ?? null,
        tokenCount: codeResult.tokenUsage
          ? codeResult.tokenUsage.inputTokens + codeResult.tokenUsage.outputTokens
          : null,
        durationMs: codeResult.durationMs,
        createdAt: new Date().toISOString(),
      }).run();

      lastModifiedFiles = codeResult.modifiedFiles;
      totalCostUsd += codeResult.costUsd ?? 0;

      if (!codeResult.success) {
        const errorMsg = `Coding failed: ${codeResult.text.slice(0, 500)}`;
        emit({ type: 'attempt_complete', attemptNum: attempt, success: false, error: errorMsg });

        retryCtrl.recordAttempt({
          attemptNum: attempt,
          errorMessage: errorMsg,
          tokensUsed: codeResult.tokenUsage
            ? codeResult.tokenUsage.inputTokens + codeResult.tokenUsage.outputTokens
            : 0,
          durationMs: codeResult.durationMs,
        });

        const { allowed, reason } = retryCtrl.canRetry();
        if (!allowed) {
          await escalate(taskId, task.prompt, plan.summary, retryCtrl, lastFailedChecks, lastModifiedFiles, totalCostUsd, reason!, emit, projectDir);
          return;
        }

        lastFailedChecks = [{ id: 'coding', description: 'Coding agent returned error', actual: errorMsg }];
        const errorTier = retryCtrl.classifyError(errorMsg);
        if (errorTier === 'strategy_change') {
          const allAgents = PluginRegistry.instance.listAgents();
          for (const alt of allAgents) {
            if (alt.id !== agentId && await alt.isAvailable()) {
              emit({ type: 'log', level: 'info', message: `Strategy change: switching from ${agent.name} to ${alt.name}` });
              agent = alt;
              agentId = alt.id;
              break;
            }
          }
        }
        continue;
      }

      emit({ type: 'log', level: 'info', message: `Code generated (attempt ${attempt}). Files: ${codeResult.modifiedFiles.join(', ') || 'none detected'}` });
      emit({ type: 'attempt_complete', attemptNum: attempt, success: true });

      // ─── Verification phase ──────────────────────────
      updateTaskStatus(taskId, 'verifying');
      emit({ type: 'status_change', status: 'verifying', message: `Verifying (attempt ${attempt})...` });

      const screenshotDir = join(process.cwd(), '.autodev', 'screenshots', taskId, `attempt-${attempt}`);
      const { runVerification } = await import('./verification');

      const verifyResult = await runVerification(
        plan.verificationSpec,
        projectDir,
        projectConfig,
        screenshotDir,
        emit,
      );

      for (const r of verifyResult.results) {
        db.insert(verifications).values({
          id: nanoid(),
          attemptId: codingAttemptId,
          checkId: r.checkId,
          type: r.type,
          status: r.status,
          expected: r.expected ?? null,
          actual: r.actual ?? null,
          screenshotPath: r.screenshotPath ?? null,
          vlmFeedback: r.vlmFeedback ?? null,
          vlmConfidence: r.vlmConfidence ?? null,
          durationMs: r.durationMs,
          createdAt: new Date().toISOString(),
        }).run();
      }

      if (verifyResult.allPassed) {
        updateTaskStatus(taskId, 'completed', {
          summary: plan.summary,
          modifiedFiles: lastModifiedFiles,
          costUsd: totalCostUsd,
          attempts: attempt,
          verificationPassed: true,
        });
        emit({ type: 'task_complete', success: true, summary: `Completed in ${attempt} attempt(s): ${plan.summary}. All checks passed. Cost: $${totalCostUsd.toFixed(4)}` });

        // Commit successful changes as new baseline
        try {
          const { getExeca } = await import('../lib/execa');
          const ex = await getExeca();
          await ex('git', ['add', '-A'], { cwd: projectDir, reject: false });
          await ex('git', ['commit', '-m', `autodev: ${plan.summary.slice(0, 72)}`], { cwd: projectDir, reject: false });
        } catch { /* git commit failed — non-critical */ }

        return;
      }

      const failedChecks = verifyResult.results.filter(r => r.status === 'fail');
      lastFailedChecks = failedChecks.map(r => ({
        id: r.checkId,
        description: r.description,
        actual: r.actual,
      }));

      const failSummary = failedChecks.map(c => c.description).join('; ');
      emit({ type: 'log', level: 'warn', message: `Attempt ${attempt} verification failed: ${failSummary}` });

      retryCtrl.recordAttempt({
        attemptNum: attempt,
        errorMessage: `Verification failed: ${failSummary}`,
        tokensUsed: codeResult.tokenUsage
          ? codeResult.tokenUsage.inputTokens + codeResult.tokenUsage.outputTokens
          : 0,
        durationMs: codeResult.durationMs,
      });

      const { allowed, reason } = retryCtrl.canRetry();
      if (!allowed) {
        await escalate(taskId, task.prompt, plan.summary, retryCtrl, lastFailedChecks, lastModifiedFiles, totalCostUsd, reason!, emit, projectDir);
        return;
      }

      emit({ type: 'log', level: 'info', message: `Will retry (${reason ?? 'checks failed'})...` });
    }

    await escalate(taskId, task.prompt, plan.summary, retryCtrl, lastFailedChecks, lastModifiedFiles, totalCostUsd, 'max_attempts', emit, projectDir);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    emit({ type: 'log', level: 'error', message: errorMessage });
    emit({ type: 'task_complete', success: false, summary: `Failed: ${errorMessage}` });
    updateTaskStatus(taskId, 'failed', { error: errorMessage });
    recordEvent(taskId, 'pipeline_error', { error: errorMessage });
  }
}

async function escalate(
  taskId: string,
  prompt: string,
  summary: string,
  retryCtrl: RetryController,
  failedChecks: Array<{ id: string; description: string; actual?: string }>,
  modifiedFiles: string[],
  totalCostUsd: number,
  stopReason: string,
  emit: EmitFn,
  projectDir: string,
): Promise<void> {
  const retrySummary = retryCtrl.getSummary();

  const report = generateEscalationReport({
    taskId,
    prompt,
    summary,
    attempts: retryCtrl.attempts,
    failedChecks,
    totalCostUsd,
    totalDurationMs: retrySummary.totalDurationMs,
    stopReason,
    modifiedFiles,
  });

  updateTaskStatus(taskId, 'escalated', {
    summary,
    modifiedFiles,
    costUsd: totalCostUsd,
    attempts: retrySummary.attempts,
    stopReason,
    failedChecks,
  });

  recordEvent(taskId, 'escalation', { report, stopReason });

  emit({ type: 'log', level: 'error', message: `Escalating: ${stopReason} after ${retrySummary.attempts} attempt(s)` });
  emit({ type: 'escalation', report });
  emit({ type: 'task_complete', success: false, summary: `Escalated (${stopReason}): ${summary}. ${retrySummary.attempts} attempt(s), $${totalCostUsd.toFixed(4)} spent.` });

  // Roll back auto-created workspaces to clean state
  if (projectDir.includes('.autodev/workspaces/') || projectDir.includes('.autodev\\workspaces\\')) {
    try {
      const { getExeca } = await import('../lib/execa');
      const ex = await getExeca();
      const gitCheck = await ex('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectDir, reject: false });
      if (gitCheck.exitCode === 0) {
        await ex('git', ['checkout', '.'], { cwd: projectDir, reject: false });
        await ex('git', ['clean', '-fdx'], { cwd: projectDir, reject: false });
        emit({ type: 'log', level: 'info', message: 'Rolled back workspace to clean state (including build artifacts)' });
      }
    } catch { /* rollback failed — non-critical */ }
  }
}

async function selectAgent(
  preferredId: string,
  emit: EmitFn,
): Promise<{ agent: ICodingAgent; agentId: string }> {
  const preferred = PluginRegistry.instance.getAgent(preferredId);
  if (preferred && await preferred.isAvailable()) {
    emit({ type: 'log', level: 'info', message: `Using agent: ${preferred.name}` });
    return { agent: preferred, agentId: preferred.id };
  }

  emit({ type: 'log', level: 'warn', message: `Agent '${preferredId}' not available, trying fallback...` });

  const allAgents = PluginRegistry.instance.listAgents();
  for (const fallback of allAgents) {
    if (fallback.id === preferredId) continue;
    if (await fallback.isAvailable()) {
      emit({ type: 'log', level: 'info', message: `Fallback: using ${fallback.name}` });
      return { agent: fallback, agentId: fallback.id };
    }
  }

  throw new Error(
    'No coding agent available. Install at least one of: Claude Code, Codex CLI, Gemini CLI, Aider, Cline CLI'
  );
}

async function resolveProjectDir(taskId: string, userDir: string | null): Promise<string> {
  if (userDir && userDir.trim()) {
    const resolved = resolve(userDir);
    const selfDir = resolve(process.cwd());
    if (resolved === selfDir || resolved.startsWith(selfDir + '/src') || resolved.startsWith(selfDir + '/bin')) {
      throw new Error(
        'Cannot use autodev-agent\'s own directory as project directory. ' +
        'Please specify a different directory or leave it empty to auto-create a workspace.'
      );
    }
    if (!existsSync(resolved)) {
      mkdirSync(resolved, { recursive: true });
    }
    return resolved;
  }

  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  const workspaceDir = join(homeDir, '.autodev', 'workspaces', taskId);
  mkdirSync(workspaceDir, { recursive: true });

  const { execa } = await import('execa');
  try {
    await execa('git', ['init'], { cwd: workspaceDir, reject: false });
    await execa('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: workspaceDir, reject: false });
  } catch { /* git not available */ }

  return workspaceDir;
}

function updateTaskStatus(taskId: string, status: TaskStatus, result?: Record<string, unknown>): void {
  const update: Record<string, unknown> = { status, updatedAt: new Date().toISOString() };
  if (result) update.result = JSON.stringify(result);
  db.update(tasks).set(update).where(eq(tasks.id, taskId)).run();
}

function recordEvent(taskId: string, type: string, data: unknown): void {
  db.insert(events).values({
    id: nanoid(),
    taskId,
    type,
    data: JSON.stringify(data),
    createdAt: new Date().toISOString(),
  }).run();
}
