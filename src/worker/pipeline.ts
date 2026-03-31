import { db } from '../lib/db/client';
import { tasks, attempts, events, verifications } from '../lib/db/schema';
import { join, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { eq, and, not, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { detectProjectType, type ProjectConfig } from '../lib/detection/project-type';
import { generatePlan } from './planning';
import { PluginRegistry } from '../lib/plugins/registry';
import { RetryController, type AttemptRecord } from './retry';
import { generateEscalationReport } from './escalation';
import { loadConfig, type AutoDevConfig } from '../lib/config';
import type { PipelineEvent, TaskStatus, PlanningMode } from '../lib/types';
import type { ICodingAgent } from '../lib/plugins/interfaces';

type EmitFn = (event: PipelineEvent) => void;

const TOOL_ARTIFACTS = ['.omc/', '.omx/', '.opencode/', '.autodev/', '.git/', '.DS_Store'];

function filterToolArtifacts(files: string[]): string[] {
  return files.filter(f => !TOOL_ARTIFACTS.some(prefix => f.startsWith(prefix)) && f !== '.DS_Store');
}

// ─── Workspace scanner (reused across cycles) ───────────
async function scanWorkspace(projectDir: string, emit: EmitFn): Promise<string> {
  try {
    const { getExeca } = await import('../lib/execa');
    const ex = await getExeca();
    const { stdout } = await ex('find', [
      projectDir, '-maxdepth', '3',
      '-not', '-path', '*/.git/*',
      '-not', '-path', '*/node_modules/*',
      '-not', '-path', '*/.next/*',
      '-not', '-path', '*/.autodev/*',
      '-not', '-path', '*/.omc/*',
      '-not', '-path', '*/.omx/*',
      '-not', '-path', '*/.opencode/*',
      '-type', 'f',
    ], { reject: false, timeout: 5_000 });

    if (stdout.trim()) {
      const files = stdout.trim().split('\n')
        .map((f: string) => f.replace(projectDir + '/', '').replace(projectDir, ''))
        .filter((f: string) => f && !f.startsWith('.'));
      if (files.length > 0 && files.length <= 50) {
        let context = `\nExisting files in project:\n${files.map((f: string) => `- ${f}`).join('\n')}`;
        const { readFileSync, statSync } = await import('fs');
        for (const f of files.slice(0, 5)) {
          try {
            const fullPath = join(projectDir, f);
            const stat = statSync(fullPath);
            if (stat.size < 10_000) {
              const content = readFileSync(fullPath, 'utf-8');
              context += `\n\nFile: ${f}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``;
            }
          } catch { /* file read failed — skip */ }
        }
        return context;
      }
    }
  } catch { /* workspace scan failed — ok */ }
  return '';
}

// ─── Single cycle result type ────────────────────────────
interface SingleCycleResult {
  success: boolean;
  summary: string;
  modifiedFiles: string[];
  costUsd: number;
  attemptCount: number;
  totalDurationMs: number;
  failedChecks: Array<{ id: string; description: string; actual?: string }>;
  attemptRecords: AttemptRecord[];
  stopReason?: string;
}

// ═════════════════════════════════════════════════════════
// Pipeline entry point
// ═════════════════════════════════════════════════════════
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

  const systemPrompt = (task as any).systemPrompt ?? null;

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

    // ─── 2. Parse config and scan workspace ──────────────
    const taskConfig = task.config
      ? (typeof task.config === 'string' ? JSON.parse(task.config) : task.config) as Record<string, any>
      : {};

    const workspaceContext = await scanWorkspace(projectDir, emit);

    // ─── 3. Determine execution mode ─────────────────────
    const executionMode = (task as any).executionMode ?? 'single';
    const maxCycles = (task as any).maxCycles ?? 10;

    if (executionMode === 'auto-cycle') {
      await runAutoCycle(taskId, task, projectDir, projectConfig, workspaceContext, systemPrompt, taskConfig, config, maxCycles, emit, projectHistory);
    } else {
      // Single mode: run once, handle completion/escalation
      const result = await runSingleCycle(
        taskId, task, projectDir, projectConfig, workspaceContext,
        systemPrompt, taskConfig, config, emit, { projectHistory },
      );

      if (result.success) {
        updateTaskStatus(taskId, 'completed', {
          summary: result.summary,
          modifiedFiles: result.modifiedFiles,
          costUsd: result.costUsd,
          attempts: result.attemptCount,
          verificationPassed: true,
        });
        emit({ type: 'task_complete', success: true, summary: `Completed in ${result.attemptCount} attempt(s): ${result.summary}. All checks passed. Cost: $${result.costUsd.toFixed(4)}` });

        // Commit successful changes as new baseline
        try {
          const { getExeca } = await import('../lib/execa');
          const ex = await getExeca();
          await ex('git', ['add', '-A'], { cwd: projectDir, reject: false });
          await ex('git', ['commit', '-m', `autodev: ${result.summary.slice(0, 72)}`], { cwd: projectDir, reject: false });
        } catch { /* git commit failed — non-critical */ }
      } else if (result.stopReason === 'plan_rejected') {
        updateTaskStatus(taskId, 'failed', { error: 'Plan rejected by user' });
        emit({ type: 'task_complete', success: false, summary: 'Plan rejected by user' });
      } else {
        await escalate(
          taskId, task.prompt, result.summary, result.attemptRecords,
          result.failedChecks, result.modifiedFiles, result.costUsd,
          result.totalDurationMs, result.stopReason ?? 'max_attempts',
          emit, projectDir,
        );
      }
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    emit({ type: 'log', level: 'error', message: errorMessage });
    emit({ type: 'task_complete', success: false, summary: `Failed: ${errorMessage}` });
    updateTaskStatus(taskId, 'failed', { error: errorMessage });
    recordEvent(taskId, 'pipeline_error', { error: errorMessage });
  }
}

// ═════════════════════════════════════════════════════════
// Single Cycle: plan → review → code → verify
// ═════════════════════════════════════════════════════════
async function runSingleCycle(
  taskId: string,
  task: any,
  projectDir: string,
  projectConfig: ProjectConfig | null,
  workspaceContext: string,
  systemPrompt: string | null,
  taskConfig: Record<string, any>,
  config: AutoDevConfig,
  emit: EmitFn,
  options?: {
    forceAutoApprove?: boolean;
    projectHistory?: Array<{ prompt: string; status: string; result: any; createdAt: string }>;
  },
): Promise<SingleCycleResult> {
  const startTime = Date.now();

  // ─── Planning ──────────────────────────────────────────
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
    systemPrompt,
  );

  emit({ type: 'log', level: 'info', message: `Plan: ${plan.summary}` });
  emit({ type: 'log', level: 'info', message: `Estimated files: ${plan.estimatedFiles.join(', ')}` });
  emit({ type: 'log', level: 'info', message: `Coding prompt: ${plan.codingPrompt.slice(0, 500)}` });
  emit({ type: 'log', level: 'info', message: `Verification: ${plan.verificationSpec.steps.map(s => `${s.id}:${s.type}(${s.description})`).join(', ')}` });
  recordEvent(taskId, 'plan_complete', { summary: plan.summary, files: plan.estimatedFiles });

  // ─── Plan Review ───────────────────────────────────────
  const autoApprove = options?.forceAutoApprove || taskConfig.autoApprove === true;

  db.update(tasks).set({
    plan: JSON.stringify(plan),
    updatedAt: new Date().toISOString(),
  }).where(eq(tasks.id, taskId)).run();

  if (!autoApprove) {
    updateTaskStatus(taskId, 'plan_review');
    emit({ type: 'status_change', status: 'plan_review', message: 'Plan ready for review. Approve to continue.' });
    emit({ type: 'plan_ready', plan: {
      summary: plan.summary,
      codingPrompt: plan.codingPrompt,
      estimatedFiles: plan.estimatedFiles,
      verificationSpec: plan.verificationSpec,
    }});

    const approved = await waitForApproval(taskId);
    if (!approved) {
      // Do NOT set task status here — caller handles final status
      return {
        success: false,
        summary: 'Plan rejected by user',
        modifiedFiles: [],
        costUsd: 0,
        attemptCount: 0,
        totalDurationMs: Date.now() - startTime,
        failedChecks: [],
        attemptRecords: [],
        stopReason: 'plan_rejected',
      };
    }

    const updatedTask = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (updatedTask?.plan) {
      const editedPlan = typeof updatedTask.plan === 'string' ? JSON.parse(updatedTask.plan as string) : updatedTask.plan;
      plan.summary = (editedPlan as any).summary ?? plan.summary;
      plan.codingPrompt = (editedPlan as any).codingPrompt ?? plan.codingPrompt;
      plan.estimatedFiles = (editedPlan as any).estimatedFiles ?? plan.estimatedFiles;
      plan.verificationSpec = (editedPlan as any).verificationSpec ?? plan.verificationSpec;
    }

    emit({ type: 'log', level: 'info', message: 'Plan approved. Starting coding...' });
  }

  // ─── GOAL_COMPLETE: skip coding entirely ────────────────
  if (plan.summary.includes('GOAL_COMPLETE') || plan.codingPrompt.trim() === '' || plan.codingPrompt.includes('No additional changes needed')) {
    emit({ type: 'log', level: 'info', message: 'Goal complete — skipping coding phase' });
    return {
      success: true,
      summary: plan.summary,
      modifiedFiles: [],
      costUsd: 0,
      attemptCount: 0,
      totalDurationMs: Date.now() - startTime,
      failedChecks: [],
      attemptRecords: [],
    };
  }

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

  // ─── Code → Verify retry loop ─────────────────────────
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

    let codingPrompt = `${systemPrompt ? systemPrompt + '\n\n' : ''}CRITICAL: You MUST only create and modify files inside this directory: ${projectDir}
Do NOT navigate to or modify files outside this directory.
Do NOT search for or modify any files in parent directories.
Your working directory is ${projectDir} — all file paths must be relative to this directory.

${plan.codingPrompt}`;
    if (workspaceContext) {
      codingPrompt = codingPrompt + `\n\n${workspaceContext}`;
    }
    const projectHistory = options?.projectHistory ?? [];
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
        return {
          success: false,
          summary: plan.summary,
          modifiedFiles: lastModifiedFiles,
          costUsd: totalCostUsd,
          attemptCount: attempt,
          totalDurationMs: Date.now() - startTime,
          failedChecks: [{ id: 'coding', description: 'Coding agent returned error', actual: errorMsg }],
          attemptRecords: retryCtrl.attempts,
          stopReason: reason,
        };
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

    lastModifiedFiles = filterToolArtifacts(codeResult.modifiedFiles);
    emit({ type: 'log', level: 'info', message: `Code generated (attempt ${attempt}). Files: ${lastModifiedFiles.join(', ') || 'none detected'}` });
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
      return {
        success: true,
        summary: plan.summary,
        modifiedFiles: lastModifiedFiles,
        costUsd: totalCostUsd,
        attemptCount: attempt,
        totalDurationMs: Date.now() - startTime,
        failedChecks: [],
        attemptRecords: retryCtrl.attempts,
      };
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
      return {
        success: false,
        summary: plan.summary,
        modifiedFiles: lastModifiedFiles,
        costUsd: totalCostUsd,
        attemptCount: attempt,
        totalDurationMs: Date.now() - startTime,
        failedChecks: lastFailedChecks,
        attemptRecords: retryCtrl.attempts,
        stopReason: reason,
      };
    }

    emit({ type: 'log', level: 'info', message: `Will retry (${reason ?? 'checks failed'})...` });
  }

  // Max retries exhausted
  return {
    success: false,
    summary: plan.summary,
    modifiedFiles: lastModifiedFiles,
    costUsd: totalCostUsd,
    attemptCount: config.maxRetries,
    totalDurationMs: Date.now() - startTime,
    failedChecks: lastFailedChecks,
    attemptRecords: retryCtrl.attempts,
    stopReason: 'max_attempts',
  };
}

// ═════════════════════════════════════════════════════════
// Auto-Cycle Loop
// ═════════════════════════════════════════════════════════
async function runAutoCycle(
  taskId: string,
  task: any,
  projectDir: string,
  projectConfig: ProjectConfig | null,
  initialWorkspaceContext: string,
  systemPrompt: string | null,
  taskConfig: Record<string, any>,
  config: AutoDevConfig,
  maxCycles: number,
  emit: EmitFn,
  projectHistory: Array<{ prompt: string; status: string; result: any; createdAt: string }>,
): Promise<void> {
  const originalGoal = task.prompt;
  const completedSteps: string[] = [];
  const allModifiedFiles: string[] = [];
  let totalCostUsd = 0;

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    // Check if user stopped the task
    const currentTask = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!currentTask || currentTask.status === 'completed' || currentTask.status === 'failed') {
      emit({ type: 'log', level: 'info', message: 'Auto-cycle stopped by user' });
      break;
    }

    emit({ type: 'cycle_start', cycleNum: cycle, totalCycles: maxCycles, message: `Starting cycle ${cycle}/${maxCycles}` });

    // Update cycle count in DB
    db.update(tasks).set({
      cycleCount: cycle,
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, taskId)).run();

    // Re-scan workspace (files may have changed from previous cycle)
    const workspaceContext = cycle === 1
      ? initialWorkspaceContext
      : await scanWorkspace(projectDir, emit);

    // Build a continuation prompt that includes progress so far
    const cyclePrompt = cycle === 1
      ? originalGoal
      : `Original goal: ${originalGoal}

Completed so far (${completedSteps.length} steps):
${completedSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Modified files so far: ${allModifiedFiles.join(', ')}

Continue working on the next step. If the original goal is fully complete, respond with a plan where the summary starts with "GOAL_COMPLETE:" followed by a description of what was accomplished.`;

    // Override the task prompt for this cycle
    const cycleTask = { ...task, prompt: cyclePrompt };

    // Force auto-approve for subsequent cycles (first cycle follows user setting)
    const forceAutoApprove = cycle > 1;

    try {
      const result = await runSingleCycle(
        taskId, cycleTask, projectDir, projectConfig,
        workspaceContext, systemPrompt, taskConfig, config, emit,
        { forceAutoApprove, projectHistory: cycle === 1 ? projectHistory : [] },
      );

      totalCostUsd += result.costUsd;

      emit({ type: 'cycle_complete', cycleNum: cycle, success: result.success, summary: result.summary });

      if (result.success) {
        completedSteps.push(result.summary);
        allModifiedFiles.push(...result.modifiedFiles);

        // Commit successful cycle changes
        try {
          const { getExeca } = await import('../lib/execa');
          const ex = await getExeca();
          await ex('git', ['add', '-A'], { cwd: projectDir, reject: false });
          await ex('git', ['commit', '-m', `autodev: cycle ${cycle} - ${result.summary.slice(0, 60)}`], { cwd: projectDir, reject: false });
        } catch { /* git commit failed — non-critical */ }

        // Check if the agent signaled completion
        if (result.summary.includes('GOAL_COMPLETE')) {
          emit({ type: 'auto_cycle_complete', totalCycles: cycle, summary: `Goal completed in ${cycle} cycles` });
          updateTaskStatus(taskId, 'completed', {
            summary: `Auto-cycle completed in ${cycle} cycles`,
            completedSteps,
            modifiedFiles: [...new Set(allModifiedFiles)],
            cycles: cycle,
            costUsd: totalCostUsd,
          });
          emit({ type: 'task_complete', success: true, summary: `Auto-cycle completed in ${cycle} cycles: ${completedSteps.join('; ')}` });
          return;
        }
      } else {
        // Plan rejected — stop the loop (user explicitly rejected, don't continue with auto-approve)
        if (result.stopReason === 'plan_rejected') {
          emit({ type: 'log', level: 'info', message: 'Plan rejected by user — stopping auto-cycle' });
          emit({ type: 'auto_cycle_complete', totalCycles: cycle, summary: 'Stopped: plan rejected by user' });
          updateTaskStatus(taskId, 'failed', {
            summary: 'Auto-cycle stopped: plan rejected by user',
            completedSteps,
            modifiedFiles: [...new Set(allModifiedFiles)],
            cycles: cycle,
            costUsd: totalCostUsd,
          });
          emit({ type: 'task_complete', success: false, summary: 'Auto-cycle stopped: plan rejected by user' });
          return;
        }

        // Other failures — log and continue to next step
        emit({ type: 'log', level: 'warn', message: `Cycle ${cycle} failed: ${result.summary}. Continuing...` });
        completedSteps.push(`[FAILED] ${result.summary}`);
      }
    } catch (err) {
      emit({ type: 'log', level: 'error', message: `Cycle ${cycle} error: ${err instanceof Error ? err.message : String(err)}` });
      completedSteps.push(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Check if we exited because task was already stopped/completed/failed
  const finalTask = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (finalTask && finalTask.status !== 'completed' && finalTask.status !== 'failed') {
    // Max cycles reached or all cycles ran
    const cyclesRan = completedSteps.length;
    emit({ type: 'auto_cycle_complete', totalCycles: cyclesRan, summary: `Reached max cycles (${maxCycles})` });
    updateTaskStatus(taskId, 'completed', {
      summary: `Auto-cycle reached max ${maxCycles} cycles`,
      completedSteps,
      modifiedFiles: [...new Set(allModifiedFiles)],
      cycles: cyclesRan,
      costUsd: totalCostUsd,
    });
    emit({ type: 'task_complete', success: true, summary: `Auto-cycle completed ${cyclesRan} cycles: ${completedSteps.join('; ')}` });
  }
}

// ═════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════
async function escalate(
  taskId: string,
  prompt: string,
  summary: string,
  attemptRecords: AttemptRecord[],
  failedChecks: Array<{ id: string; description: string; actual?: string }>,
  modifiedFiles: string[],
  totalCostUsd: number,
  totalDurationMs: number,
  stopReason: string,
  emit: EmitFn,
  projectDir: string,
): Promise<void> {
  const report = generateEscalationReport({
    taskId,
    prompt,
    summary,
    attempts: attemptRecords,
    failedChecks,
    totalCostUsd,
    totalDurationMs,
    stopReason,
    modifiedFiles,
  });

  updateTaskStatus(taskId, 'escalated', {
    summary,
    modifiedFiles,
    costUsd: totalCostUsd,
    attempts: attemptRecords.length,
    stopReason,
    failedChecks,
  });

  recordEvent(taskId, 'escalation', { report, stopReason });

  emit({ type: 'log', level: 'error', message: `Escalating: ${stopReason} after ${attemptRecords.length} attempt(s)` });
  emit({ type: 'escalation', report });
  emit({ type: 'task_complete', success: false, summary: `Escalated (${stopReason}): ${summary}. ${attemptRecords.length} attempt(s), $${totalCostUsd.toFixed(4)} spent.` });

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

async function waitForApproval(taskId: string, timeoutMs: number = 600_000): Promise<boolean> {
  const pollIntervalMs = 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task) return false;

    if (task.status !== 'plan_review') {
      return task.status === 'coding';
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  return false;
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
