import { db } from '../lib/db/client';
import { tasks, attempts, events } from '../lib/db/schema';
import { join, resolve } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { eq, and, not, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { detectProjectType, type ProjectConfig } from '../lib/detection/project-type';
import { selectAgent } from '../lib/agent-selector';
import { McpManager } from '../lib/harness/mcp-manager';
import { buildProjectContext, formatContextCompact, formatContext } from '../lib/harness/context-builder';
import type { McpServerInfo } from '../lib/plugins/interfaces';
import type { AttemptRecord } from './retry';
import { generateEscalationReport } from './escalation';
import { loadConfig, type AutoDevConfig } from '../lib/config';
import type { TaskStatus } from '../lib/types';
import { ProgressDetector } from '../lib/safety/progress-detector';
import { HookEngine } from '../lib/hooks/hook-engine';
import { type EmitFn, type SingleCycleResult, checkAbort } from './pipeline-types';

export async function runPipeline(taskId: string, rawEmit: EmitFn, signal?: AbortSignal): Promise<void> {
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
  emit({ type: 'log', level: 'info', message: `Safety: AbortController active, destructive command check enabled` });

  // Save auto-created workspace path back to DB
  if (!task.projectDir) {
    db.update(tasks).set({
      projectDir: projectDir,
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, taskId)).run();
  }

  const config = await loadConfig(projectDir);

  // ─── Hook Engine ──────────────────────────────────────
  const hookEngine = new HookEngine();
  await hookEngine.load(projectDir);

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

  // ─── Initialize MCP Manager ─────────────────────────────
  const mcpManager = new McpManager(projectDir);
  const mcpConfig = mcpManager.getConfig();
  const enabledServers = Object.entries(mcpConfig.servers)
    .filter(([, s]) => s.enabled)
    .map(([id]) => id);

  if (enabledServers.length > 0) {
    emit({ type: 'log', level: 'info', message: `MCP servers configured: ${enabledServers.join(', ')}` });
  }

  const planningMcps = mcpConfig.pipeline_mapping.planning.filter(id => enabledServers.includes(id));
  const verifyMcps = mcpConfig.pipeline_mapping.verification.filter(id => enabledServers.includes(id));
  if (planningMcps.length > 0) {
    emit({ type: 'log', level: 'info', message: `Planning MCP: ${planningMcps.join(', ')}` });
  }
  if (verifyMcps.length > 0) {
    emit({ type: 'log', level: 'info', message: `Verification MCP: ${verifyMcps.join(', ')}` });
  }

  // 실제 MCP 프로토콜 연결
  try {
    await mcpManager.connectAll(emit);
    const connectedTools = mcpManager.getConnectedTools();
    if (connectedTools.length > 0) {
      emit({ type: 'log', level: 'info',
        message: `[MCP] ${connectedTools.length} tools connected: ${connectedTools.map(t => `${t.serverId}/${t.name}`).join(', ')}` });
    }

    // 활성화되었지만 연결 실패한 서버를 명시적으로 표시
    const mcpClient = mcpManager.getMcpClient();
    const failedServers = enabledServers.filter(id => !mcpClient.isConnected(id));
    if (failedServers.length > 0) {
      emit({ type: 'log', level: 'warn',
        message: `[MCP] Failed to connect: ${failedServers.join(', ')}. Verify Agent will use fallback Playwright (if available).` });
    }
  } catch (err) {
    emit({ type: 'log', level: 'warn', message: `[MCP] Connection failed: ${err}` });
  }

  const planningMcpPrompt = mcpManager.getMcpPromptSection('planning');
  const codingMcpServers = mcpManager.getServersForStage('coding');
  const codingMcpPrompt = mcpManager.getMcpPromptSection('coding');
  const verifyMcpPrompt = mcpManager.getMcpPromptSection('verification');

  try {
    // ─── 1. Detect project type ──────────────────────────
    checkAbort(signal);
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

    // ─── 2. Parse config and build project context ───────
    const taskConfig = task.config
      ? (typeof task.config === 'string' ? JSON.parse(task.config) : task.config) as Record<string, any>
      : {};

    emit({ type: 'log', level: 'info', message: 'Building project context...' });
    let previousTaskSummary: string | undefined;
    if (projectHistory.length > 0) {
      try {
        const lastResult = projectHistory[0].result;
        const parsed = lastResult ? (typeof lastResult === 'string' ? JSON.parse(lastResult) : lastResult) : {};
        previousTaskSummary = parsed?.summary;
      } catch { /* ignore */ }
    }
    const projectCtx = await buildProjectContext(projectDir, previousTaskSummary);
    let workspaceContext = formatContextCompact(projectCtx);
    if (planningMcpPrompt) {
      workspaceContext += '\n' + planningMcpPrompt;
    }
    emit({ type: 'log', level: 'info', message: `Context: branch=${projectCtx.gitBranch ?? 'n/a'}, files=${projectCtx.fileCount}, changed=${projectCtx.changedFiles.length}` });
    if (projectCtx.packageInfo) {
      emit({ type: 'log', level: 'info', message: `Package: ${projectCtx.packageInfo.name} (${projectCtx.packageInfo.dependencies.length} deps, scripts: ${projectCtx.packageInfo.scripts.join(', ')})` });
    }

    // ─── 2.5 TaskStart hook ──────────────────────────────
    {
      const taskStartHooks = await hookEngine.execute(
        { event: 'TaskStart', taskId, projectDir, prompt: task.prompt },
        emit,
      );
      if (taskStartHooks.mergedContext) {
        workspaceContext += `\n\n## Hook Context\n${taskStartHooks.mergedContext}`;
      }
    }

    // ─── Project Memory ──────────────────────────────────
    {
      const { loadProjectMemory, formatMemoryForPrompt } = await import('../lib/harness/memory-manager');
      const projectMemory = loadProjectMemory(projectDir);
      const memoryContext = formatMemoryForPrompt(projectMemory);
      if (memoryContext) {
        workspaceContext += memoryContext;
        emit({ type: 'log', level: 'info', message: `Project memory loaded: ${projectMemory.decisions.length} decisions, ${projectMemory.customNotes.length} custom notes` });
      }
    }

    // ─── Task Chain Context ──────────────────────────────
    if (task?.parentTaskId) {
      const parentTask = db.select().from(tasks).where(eq(tasks.id, task.parentTaskId)).get();
      if (parentTask) {
        const parentResult = parentTask.result
          ? (typeof parentTask.result === 'string' ? JSON.parse(parentTask.result as string) : parentTask.result)
          : {};
        const chainContext = `## Chained from previous task
**Previous prompt**: ${parentTask.prompt}
**Previous result**: ${(parentResult as any)?.summary ?? 'completed'}
**Previous project**: ${parentTask.projectDir ?? 'unknown'}
**Modified files**: ${((parentResult as any)?.modifiedFiles ?? []).join(', ') || 'none'}

Use this context to continue the work. The current task builds upon the previous task's results.`;
        workspaceContext += '\n\n' + chainContext;
        emit({ type: 'log', level: 'info', message: `Task chain: linked from parent task ${parentTask.id.slice(0, 8)}` });
      }
    }

    // ─── 3. Determine execution mode ─────────────────────
    const executionMode = (task as any).executionMode ?? 'single';
    const maxCycles = (task as any).maxCycles ?? 10;

    if (executionMode === 'auto-cycle') {
      await runAutoCycle(taskId, task, projectDir, projectConfig, workspaceContext, systemPrompt, taskConfig, config, maxCycles, emit, projectHistory, codingMcpServers, codingMcpPrompt, verifyMcpPrompt);
    } else if (executionMode === 'interview' && !(taskConfig as any).interviewAnswers) {
      // ─── Interview Mode: check if prompt is already specific enough ───
      const { InterviewAgent } = await import('../agents/interview/interview-agent');

      if (InterviewAgent.shouldSkip(task.prompt)) {
        emit({ type: 'log', level: 'info', message: 'Prompt specific enough, skipping interview.' });
        const result = await runSingleCycle(
          taskId, task, projectDir, projectConfig, workspaceContext,
          systemPrompt, taskConfig, config, emit,
          { projectHistory, codingMcpServers, codingMcpPrompt, verifyMcpPrompt, signal, mcpManager },
        );
        if (result.success) {
          if (projectDir) {
            const nameFile = join(projectDir, '.autodev', 'project-name.txt');
            if (!existsSync(nameFile)) {
              try {
                mkdirSync(join(projectDir, '.autodev'), { recursive: true });
                const planDataObj = typeof task.plan === 'string' ? JSON.parse(task.plan as string) : task.plan;
                const summary = (planDataObj as any)?.summary ?? task.prompt ?? '';
                const projectName = summary.slice(0, 50).replace(/[/\\:*?"<>|]/g, '');
                if (projectName) writeFileSync(nameFile, projectName, 'utf-8');
              } catch { /* non-critical */ }
            }
          }
          try {
            const { updateMemoryAfterTask } = await import('../lib/harness/memory-manager');
            updateMemoryAfterTask(projectDir, task.prompt, result.summary ?? '', result.modifiedFiles ?? [],
              projectConfig ? { type: projectConfig.type } : undefined);
          } catch { /* non-critical */ }
          updateTaskStatus(taskId, 'completed', { summary: result.summary, modifiedFiles: result.modifiedFiles, costUsd: result.costUsd, attempts: result.attemptCount, verificationPassed: true });
          emit({ type: 'task_complete', success: true, summary: result.summary });
        } else if (result.stopReason === 'plan_rejected') {
          updateTaskStatus(taskId, 'failed', { error: 'Plan rejected by user' });
          emit({ type: 'task_complete', success: false, summary: 'Plan rejected by user' });
        } else {
          await escalate(taskId, task.prompt, result.summary, result.attemptRecords, result.failedChecks, result.modifiedFiles, result.costUsd, result.totalDurationMs, result.stopReason ?? 'max_attempts', emit, projectDir);
        }
        return;
      }

      // ─── Generate clarifying questions ───────────────────
      emit({ type: 'status_change', status: 'interview' as TaskStatus, message: 'Generating clarifying questions...' });

      const cliMode = (task as any).planningMode ?? 'claude-cli';
      const interviewAgent = new InterviewAgent(cliMode);
      const interviewResult = await interviewAgent.invoke({
        prompt: task.prompt,
        context: { projectDir },
        config: {},
        onProgress: emit,
      });
      const questions = interviewResult.result.questions;

      const interviewConfig = typeof task.config === 'string' ? JSON.parse(task.config ?? '{}') : (task.config ?? {});
      (interviewConfig as any).interviewQuestions = questions;

      db.update(tasks).set({
        status: 'interview' as TaskStatus,
        config: JSON.stringify(interviewConfig),
        updatedAt: new Date().toISOString(),
      }).where(eq(tasks.id, taskId)).run();

      emit({ type: 'interview_questions', questions, message: 'Please answer these questions to help plan your task.' });
      emit({ type: 'log', level: 'info', message: `Generated ${questions.length} interview questions. Waiting for answers...` });
      return;
    } else {
      // Single mode: run once, handle completion/escalation
      const result = await runSingleCycle(
        taskId, task, projectDir, projectConfig, workspaceContext,
        systemPrompt, taskConfig, config, emit,
        { projectHistory, codingMcpServers, codingMcpPrompt, verifyMcpPrompt, signal, mcpManager },
      );

      if (result.success) {
        // Auto-generate project name from first task summary
        if (projectDir) {
          const nameFile = join(projectDir, '.autodev', 'project-name.txt');
          if (!existsSync(nameFile)) {
            try {
              mkdirSync(join(projectDir, '.autodev'), { recursive: true });
              const planData = typeof task.plan === 'string' ? JSON.parse(task.plan as string) : task.plan;
              const summary = (planData as any)?.summary ?? task.prompt ?? '';
              const projectName = summary.slice(0, 50).replace(/[/\\:*?"<>|]/g, '');
              if (projectName) {
                writeFileSync(nameFile, projectName, 'utf-8');
                emit({ type: 'log', level: 'info', message: `Project named: ${projectName}` });
              }
            } catch { /* non-critical */ }
          }
        }

        try {
          const { updateMemoryAfterTask } = await import('../lib/harness/memory-manager');
          updateMemoryAfterTask(projectDir, task.prompt, result.summary ?? '', result.modifiedFiles ?? [],
            projectConfig ? { type: projectConfig.type } : undefined);
        } catch { /* non-critical */ }

        // Commit successful changes as new baseline (before updateTaskStatus so hash is available)
        let commitHash = '';
        try {
          const { getExeca } = await import('../lib/execa');
          const ex = await getExeca();
          await ex('git', ['add', '-A'], { cwd: projectDir, reject: false });
          await ex('git', ['commit', '-m', `autodev: ${result.summary.slice(0, 72)}`], { cwd: projectDir, reject: false });
          const { stdout: hash } = await ex('git', ['rev-parse', 'HEAD'], { cwd: projectDir, reject: false }) as { stdout: string };
          commitHash = hash.trim();
        } catch { /* git commit failed — non-critical */ }

        updateTaskStatus(taskId, 'completed', {
          summary: result.summary,
          modifiedFiles: result.modifiedFiles,
          costUsd: result.costUsd,
          attempts: result.attemptCount,
          verificationPassed: true,
          ...(commitHash ? { commitHash } : {}),
        });
        emit({ type: 'task_complete', success: true, summary: `Completed in ${result.attemptCount} attempt(s): ${result.summary}. All checks passed. Cost: $${result.costUsd.toFixed(4)}` });

        // ─── TaskComplete hook (async notification) ────────
        hookEngine.execute(
          { event: 'TaskComplete', taskId, projectDir, summary: result.summary, costUsd: result.costUsd, modifiedFiles: result.modifiedFiles },
          emit,
        ).catch(() => { /* non-critical */ });
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
        // ─── TaskFail hook (async notification) ──────────
        hookEngine.execute(
          { event: 'TaskFail', taskId, projectDir, error: result.summary, attempts: result.attemptCount },
          emit,
        ).catch(() => { /* non-critical */ });
      }
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    emit({ type: 'log', level: 'error', message: errorMessage });
    emit({ type: 'task_complete', success: false, summary: `Failed: ${errorMessage}` });
    updateTaskStatus(taskId, 'failed', { error: errorMessage });
    recordEvent(taskId, 'pipeline_error', { error: errorMessage });
    // ─── TaskFail hook (async notification) ────────────
    hookEngine.execute(
      { event: 'TaskFail', taskId, projectDir, error: errorMessage, attempts: 0 },
      emit,
    ).catch(() => { /* non-critical */ });
  } finally {
    await mcpManager.shutdown();
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
    codingMcpServers?: McpServerInfo[];
    codingMcpPrompt?: string;
    verifyMcpPrompt?: string;
    signal?: AbortSignal;
    mcpManager?: McpManager;
  },
): Promise<SingleCycleResult> {
  const signal = options?.signal;
  const startTime = Date.now();

  // ─── Hook Engine (cycle-scoped) ───────────────────────
  const hookEngine = new HookEngine();
  await hookEngine.load(projectDir);
  // Accumulated context injected into each coding attempt prompt
  let hookContextAccumulator = '';

  // ─── Planning (delegated to pipeline-planning.ts) ──────
  const { executePlanning } = await import('./pipeline-planning');
  const planningResult = await executePlanning({
    taskId, projectDir, projectConfig, workspaceContext, systemPrompt,
    task, taskConfig, hookEngine, hookContextAccumulator, emit,
  });
  const planResult = planningResult.planResult;
  hookContextAccumulator = planningResult.hookContextAccumulator;
  const plan = planResult.plan;
  recordEvent(taskId, 'plan_complete', { summary: plan.summary, files: plan.estimatedFiles });

  // ─── Agent Selection (from LLM recommendation) ────────
  const taskCategory = plan.taskCategory ?? 'unknown';
  emit({ type: 'log', level: 'info', message: `Task category: ${taskCategory}` });

  let { agent, agentId, autoSelected } = await selectAgent(
    plan.recommendedAgent,
    (task as any).agentId,
    taskConfig.costPreference ?? undefined,
  );
  emit({ type: 'log', level: 'info', message: `${autoSelected ? 'Auto-selected' : 'Using'} agent: ${agent.name} (${taskCategory})` });

  // ─── Verify Agent Selection ────────────────────────────
  const { VerifyAgent } = await import('../agents/verify/verify-agent');
  const verifyAgent = await VerifyAgent.selectDifferentFrom(agentId);
  const useVerifyAgent = await verifyAgent.isAvailable();

  if (useVerifyAgent) {
    emit({ type: 'log', level: 'info', message: `[Pipeline] Verify Agent: ${verifyAgent.name} (different from coding: ${agentId})` });
  } else {
    emit({ type: 'log', level: 'info', message: '[Pipeline] Verify Agent not available, falling back to mechanical checks' });
  }

  // ─── Plan Review ───────────────────────────────────────
  const autoApprove = options?.forceAutoApprove || taskConfig.autoApprove === true;

  db.update(tasks).set({
    plan: JSON.stringify(plan),
    updatedAt: new Date().toISOString(),
  }).where(eq(tasks.id, taskId)).run();

  // Always emit plan_ready so UI can display it regardless of autoApprove
  emit({ type: 'plan_ready', plan: {
    summary: plan.summary,
    codingPrompt: plan.codingPrompt,
    estimatedFiles: plan.estimatedFiles,
    verificationSpec: plan.verificationSpec,
    taskCategory,
    recommendedAgent: plan.recommendedAgent,
    agentName: agent.name,
    agentId,
    autoSelected,
  }});

  if (!autoApprove) {
    updateTaskStatus(taskId, 'plan_review');
    emit({ type: 'status_change', status: 'plan_review', message: 'Plan ready for review. Approve to continue.' });

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

    // ─── PlanReview hook (context injection only) ────────
    const planReviewHooks = await hookEngine.execute(
      { event: 'PlanReview', taskId, projectDir, plan: { summary: plan.summary }, userAction: 'approved' },
      emit,
    );
    if (planReviewHooks.mergedContext) {
      hookContextAccumulator += (hookContextAccumulator ? '\n' : '') + planReviewHooks.mergedContext;
    }
  } else {
    emit({ type: 'log', level: 'info', message: 'Auto-approved. Starting coding...' });
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

  // ─── Re-plan outer loop setup ─────────────────────────
  const MAX_REPLANS = 2;
  let replanCount = 0;
  let currentPlan = plan;
  let replanFeedback: { issues: string[]; suggestions: string[]; previousSummary: string } | null = null;

  // Validate verification spec against actual project — remove impossible checks
  if (!projectConfig?.buildCmd) {
    const hasPkgJson = existsSync(join(projectDir, 'package.json'));
    if (!hasPkgJson) {
      currentPlan.verificationSpec.steps = currentPlan.verificationSpec.steps.filter(s => {
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
      if (currentPlan.verificationSpec.steps.length === 0) {
        currentPlan.verificationSpec.steps.push({
          id: 'v1',
          description: 'Output files exist',
          type: 'file_check',
          filePath: currentPlan.estimatedFiles[0] ?? 'index.html',
        });
      }
    }
  }

  // ─── Code → Verify retry loop ─────────────────────────
  let totalCostUsd = planResult.costUsd;

  if (planResult.costUsd > 0) {
    emit({
      type: 'cost_update',
      attemptNum: 0,
      costUsd: planResult.costUsd,
      totalCostUsd,
      inputTokens: planResult.inputTokens,
      outputTokens: planResult.outputTokens,
      agentId: `planning-${(task as any).planningMode ?? 'claude-cli'}`,
    });
    db.insert(attempts).values({
      id: nanoid(),
      taskId,
      attemptNum: 0,
      agentId: `planning-${(task as any).planningMode ?? 'claude-cli'}`,
      phase: 'planning',
      status: 'success',
      input: JSON.stringify({ prompt: task.prompt?.slice(0, 2000) }),
      output: JSON.stringify({ summary: plan.summary }),
      errorLog: null,
      errorHash: null,
      costUsd: planResult.costUsd,
      tokenCount: planResult.inputTokens + planResult.outputTokens,
      durationMs: null,
      createdAt: new Date().toISOString(),
    }).run();
  }

  // ─── Git dirty state check ──────────────────────────
  try {
    const { getExeca } = await import('../lib/execa');
    const ex = await getExeca();
    const gitResult = await ex('git', ['status', '--porcelain'], {
      cwd: projectDir, reject: false, timeout: 5_000,
    } as any);
    const gitStatus = (gitResult.stdout ?? '') as string;

    if (gitStatus.trim()) {
      const changedCount = gitStatus.trim().split('\n').length;
      emit({
        type: 'log',
        level: 'warn',
        message: `⚠ ${changedCount} uncommitted change(s) detected. Coding agent may modify these files. Consider committing first.`,
      });
    }
  } catch { /* not a git repo, skip */ }

  // ═══ Re-plan outer loop ═══════════════════════════════
  while (replanCount <= MAX_REPLANS) {
    // ─── Re-plan: generate new plan with Verify Agent feedback ───
    if (replanFeedback) {
      replanCount++;
      emit({ type: 'log', level: 'info', message: `[Re-plan] Attempt ${replanCount}/${MAX_REPLANS} — regenerating plan with Verify Agent feedback` });
      emit({ type: 'status_change', status: 'planning' as TaskStatus, message: `Re-planning (attempt ${replanCount})...` });

      try {
        const { executeReplan } = await import('./pipeline-planning');
        const replanResult = await executeReplan({
          taskId, projectDir, projectConfig, workspaceContext, systemPrompt,
          task, replanFeedback, hookEngine, hookContextAccumulator, emit,
        });

        currentPlan = replanResult.plan;
        totalCostUsd += replanResult.costUsd;
        hookContextAccumulator = replanResult.hookContextAccumulator;

        emit({ type: 'cost_update', attemptNum: 0, costUsd: replanResult.costUsd, totalCostUsd, inputTokens: replanResult.inputTokens, outputTokens: replanResult.outputTokens, agentId: `planning-${(task as any).planningMode ?? 'claude-cli'}` });
        emit({ type: 'log', level: 'info', message: `[Re-plan] New plan: ${currentPlan.summary}` });

        db.update(tasks).set({
          plan: JSON.stringify(currentPlan),
          updatedAt: new Date().toISOString(),
        }).where(eq(tasks.id, taskId)).run();

        if (replanResult.costUsd > 0) {
          db.insert(attempts).values({
            id: nanoid(),
            taskId,
            attemptNum: 0,
            agentId: `planning-${(task as any).planningMode ?? 'claude-cli'}`,
            phase: 'planning',
            status: 'success',
            input: JSON.stringify({ prompt: task.prompt?.slice(0, 2000), replanAttempt: replanCount }),
            output: JSON.stringify({ summary: currentPlan.summary }),
            errorLog: null,
            errorHash: null,
            costUsd: replanResult.costUsd,
            tokenCount: replanResult.inputTokens + replanResult.outputTokens,
            durationMs: null,
            createdAt: new Date().toISOString(),
          }).run();
        }

        // Validate verification spec for new plan
        if (!projectConfig?.buildCmd) {
          const hasPkgJson = existsSync(join(projectDir, 'package.json'));
          if (!hasPkgJson) {
            currentPlan.verificationSpec.steps = currentPlan.verificationSpec.steps.filter(s => {
              if (s.type === 'build_check' || s.type === 'port_check' || s.type === 'http_check' || s.type === 'dom_check') return false;
              return true;
            });
            if (currentPlan.verificationSpec.steps.length === 0) {
              currentPlan.verificationSpec.steps.push({
                id: 'v1', description: 'Output files exist', type: 'file_check',
                filePath: currentPlan.estimatedFiles[0] ?? 'index.html',
              });
            }
          }
        }

        replanFeedback = null;
      } catch (replanError) {
        emit({ type: 'log', level: 'error', message: `[Re-plan] Failed: ${replanError}` });
        break;
      }
    }

    // ─── Coding + Verification loop (delegated to pipeline-coding.ts) ───
    const { executeCodingLoop } = await import('./pipeline-coding');
    const codingResult = await executeCodingLoop({
      taskId, projectDir, projectConfig, task, currentPlan,
      workspaceContext, systemPrompt, agentId, agent, verifyAgent,
      useVerifyAgent,
      codingMcpServers: options?.codingMcpServers ?? [],
      codingMcpPrompt: options?.codingMcpPrompt ?? '',
      verifyMcpPrompt: options?.verifyMcpPrompt ?? '',
      config, hookEngine, hookContextAccumulator, totalCostUsd,
      signal, projectHistory: options?.projectHistory,
      mcpManager: options?.mcpManager,
      emit, updateTaskStatus, startTime,
    });

    // Sync state back from coding loop
    totalCostUsd = codingResult.totalCostUsd;
    hookContextAccumulator = codingResult.hookContextAccumulator;
    agentId = codingResult.agentId;

    if (codingResult.success) {
      return {
        success: true,
        summary: currentPlan.summary,
        modifiedFiles: codingResult.lastModifiedFiles,
        costUsd: codingResult.totalCostUsd,
        attemptCount: codingResult.attemptCount,
        totalDurationMs: Date.now() - startTime,
        failedChecks: [],
        attemptRecords: codingResult.retryAttempts,
      };
    }

    // Handle re-plan feedback from coding loop
    if (codingResult.replanFeedback) {
      replanFeedback = codingResult.replanFeedback;
    }

    // Check if re-plan is needed
    if (!replanFeedback) {
      // No re-plan requested — max retries exhausted for this plan
      return {
        success: false,
        summary: currentPlan.summary,
        modifiedFiles: codingResult.lastModifiedFiles,
        costUsd: codingResult.totalCostUsd,
        attemptCount: codingResult.attemptCount,
        totalDurationMs: Date.now() - startTime,
        failedChecks: codingResult.lastFailedChecks,
        attemptRecords: codingResult.retryAttempts,
        stopReason: codingResult.stopReason ?? 'max_attempts',
      };
    }

    // Check re-plan budget
    if (replanCount >= MAX_REPLANS) {
      emit({ type: 'log', level: 'warn', message: `[Re-plan] Max re-plans reached (${MAX_REPLANS}). Escalating.` });
      return {
        success: false,
        summary: currentPlan.summary,
        modifiedFiles: codingResult.lastModifiedFiles,
        costUsd: codingResult.totalCostUsd,
        attemptCount: codingResult.attemptCount,
        totalDurationMs: Date.now() - startTime,
        failedChecks: codingResult.lastFailedChecks,
        attemptRecords: codingResult.retryAttempts,
        stopReason: 'max_replans',
      };
    }
  } // ═══ End of re-plan outer loop ═══════════════════════

  // All plans exhausted (should not normally reach here)
  return {
    success: false,
    summary: currentPlan.summary,
    modifiedFiles: [],
    costUsd: totalCostUsd,
    attemptCount: 0,
    totalDurationMs: Date.now() - startTime,
    failedChecks: [],
    attemptRecords: [],
    stopReason: 'max_replans',
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
  codingMcpServers: McpServerInfo[] = [],
  codingMcpPrompt = '',
  verifyMcpPrompt = '',
): Promise<void> {
  const originalGoal = task.prompt;
  const completedSteps: string[] = [];
  const allModifiedFiles: string[] = [];
  let totalCostUsd = 0;

  const progressDetector = new ProgressDetector({
    maxCostUsd: taskConfig.maxCostUsd ?? 5.0,
    maxConsecutiveFailures: taskConfig.maxConsecutiveFailures ?? 3,
  });

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    // Check if user stopped the task
    const currentTask = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!currentTask || currentTask.status === 'completed' || currentTask.status === 'failed') {
      emit({ type: 'log', level: 'info', message: 'Auto-cycle stopped by user' });
      break;
    }

    const stats = progressDetector.getStats();
    emit({ type: 'cycle_start', cycleNum: cycle, totalCycles: maxCycles, message: `Starting cycle ${cycle}/${maxCycles} (${stats.passed} passed, ${stats.failed} failed, $${stats.totalCost.toFixed(4)})` });

    // Update cycle count in DB
    db.update(tasks).set({
      cycleCount: cycle,
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, taskId)).run();

    // Re-build context (files may have changed from previous cycle)
    const workspaceContext = cycle === 1
      ? initialWorkspaceContext
      : formatContext(await buildProjectContext(projectDir));

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
        { forceAutoApprove, projectHistory: cycle === 1 ? projectHistory : [], codingMcpServers, codingMcpPrompt, verifyMcpPrompt },
      );

      totalCostUsd += result.costUsd;

      emit({ type: 'cycle_complete', cycleNum: cycle, success: result.success, summary: result.summary });

      // Record cycle result and check progress
      progressDetector.record({
        cycle,
        success: result.success,
        summary: result.summary,
        modifiedFiles: result.modifiedFiles ?? [],
        costUsd: result.costUsd,
        errorMessage: result.success ? undefined : result.summary,
      });

      const progressCheck = progressDetector.check();

      if (progressCheck.recommendation === 'warn') {
        emit({ type: 'log', level: 'warn', message: `⚠ ${progressCheck.reason}` });
      }

      if (!progressCheck.shouldContinue) {
        const cycleStats = progressDetector.getStats();
        emit({
          type: 'log',
          level: 'warn',
          message: `Auto-cycle stopped: ${progressCheck.reason}`,
        });
        emit({
          type: 'auto_cycle_complete',
          totalCycles: cycle,
          summary: `Stopped after ${cycle} cycles (${cycleStats.passed} passed, ${cycleStats.failed} failed, $${cycleStats.totalCost.toFixed(4)}): ${progressCheck.reason}`,
        });
        updateTaskStatus(taskId, 'failed', {
          summary: `Auto-cycle stopped: ${progressCheck.reason}`,
          completedSteps,
          modifiedFiles: [...new Set(allModifiedFiles)],
          cycles: cycle,
          costUsd: totalCostUsd,
          stopReason: progressCheck.reason,
        });
        emit({ type: 'task_complete', success: false, summary: `Auto-cycle stopped: ${progressCheck.reason}` });
        return;
      }

      if (result.success) {
        completedSteps.push(result.summary);
        allModifiedFiles.push(...result.modifiedFiles);

        // Commit successful cycle changes
        let cycleCommitHash = '';
        try {
          const { getExeca } = await import('../lib/execa');
          const ex = await getExeca();
          await ex('git', ['add', '-A'], { cwd: projectDir, reject: false });
          await ex('git', ['commit', '-m', `autodev: cycle ${cycle} - ${result.summary.slice(0, 60)}`], { cwd: projectDir, reject: false });
          const { stdout: hash } = await ex('git', ['rev-parse', 'HEAD'], { cwd: projectDir, reject: false }) as { stdout: string };
          cycleCommitHash = hash.trim();
        } catch { /* git commit failed — non-critical */ }

        // Check if the agent signaled completion
        if (result.summary.includes('GOAL_COMPLETE')) {
          emit({ type: 'auto_cycle_complete', totalCycles: cycle, summary: `Goal completed in ${cycle} cycles` });
          try {
            const { updateMemoryAfterTask } = await import('../lib/harness/memory-manager');
            updateMemoryAfterTask(projectDir, task.prompt, `Auto-cycle completed in ${cycle} cycles`, [...new Set(allModifiedFiles)],
              projectConfig ? { type: projectConfig.type } : undefined);
          } catch { /* non-critical */ }
          updateTaskStatus(taskId, 'completed', {
            summary: `Auto-cycle completed in ${cycle} cycles`,
            completedSteps,
            modifiedFiles: [...new Set(allModifiedFiles)],
            cycles: cycle,
            costUsd: totalCostUsd,
            ...(cycleCommitHash ? { commitHash: cycleCommitHash } : {}),
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
    try {
      const { updateMemoryAfterTask } = await import('../lib/harness/memory-manager');
      updateMemoryAfterTask(projectDir, task.prompt, `Auto-cycle reached max ${maxCycles} cycles`, [...new Set(allModifiedFiles)],
        projectConfig ? { type: projectConfig.type } : undefined);
    } catch { /* non-critical */ }
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
    // Ensure git repo exists for diff support
    if (!existsSync(join(resolved, '.git'))) {
      const { execa: _execa } = await import('execa');
      try {
        await _execa('git', ['init'], { cwd: resolved, reject: false } as any);
        await _execa('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: resolved, reject: false } as any);
      } catch { /* git not available */ }
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
