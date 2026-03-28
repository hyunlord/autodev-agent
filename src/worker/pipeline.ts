import { db } from '../lib/db/client';
import { tasks, attempts, events } from '../lib/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { detectProjectType } from '../lib/detection/project-type';
import { generatePlan, type Plan } from './planning';
import { PluginRegistry } from '../lib/plugins/registry';
import type { PipelineEvent, TaskStatus, PlanningMode } from '../lib/types';

type EmitFn = (event: PipelineEvent) => void;

export async function runPipeline(taskId: string, emit: EmitFn): Promise<void> {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) {
    emit({ type: 'log', level: 'error', message: `Task ${taskId} not found` });
    return;
  }

  const projectDir = task.projectDir ?? process.cwd();

  try {
    // 2. Detect project type
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

    // 3. Planning phase
    const taskConfig = task.config ? (typeof task.config === 'string' ? JSON.parse(task.config) : task.config) as Record<string, any> : {};
    const plan = await generatePlan(
      task.prompt,
      projectConfig,
      (task.planningMode ?? 'auto') as PlanningMode,
      taskConfig.codingPrompt ? {
        codingPrompt: taskConfig.codingPrompt,
        verificationChecklist: taskConfig.verificationChecklist ?? '',
      } : undefined,
      (msg) => emit({ type: 'log', level: 'info', message: msg }),
    );

    emit({ type: 'log', level: 'info', message: `Plan: ${plan.summary}` });
    emit({ type: 'log', level: 'info', message: `Estimated files: ${plan.estimatedFiles.join(', ')}` });

    recordAttempt(taskId, 1, 'claude-code', 'planning', 'success', {
      input: { prompt: task.prompt },
      output: { plan },
    });

    recordEvent(taskId, 'plan_complete', { summary: plan.summary, files: plan.estimatedFiles });

    // 4. Coding phase
    updateTaskStatus(taskId, 'coding');
    emit({ type: 'status_change', status: 'coding', message: 'Sending task to Claude Code...' });
    emit({ type: 'attempt_start', attemptNum: 1, agentId: 'claude-code' });

    const agent = PluginRegistry.instance.getAgent('claude-code');
    if (!agent) {
      throw new Error('No coding agent available. Is Claude Code CLI installed?');
    }

    const available = await agent.isAvailable();
    if (!available) {
      throw new Error('Claude Code CLI is not installed or not accessible. Install it with: npm install -g @anthropic-ai/claude-code');
    }

    const codeResult = await agent.invoke({
      task: plan.codingPrompt,
      projectDir,
      maxTurns: 20,
      timeoutMs: 300_000,
      onProgress: (event) => emit(event),
    });

    recordAttempt(taskId, 1, 'claude-code', 'coding', codeResult.success ? 'success' : 'error', {
      input: { codingPrompt: plan.codingPrompt },
      output: {
        text: codeResult.text.slice(0, 5000),
        modifiedFiles: codeResult.modifiedFiles,
        costUsd: codeResult.costUsd,
      },
      errorLog: codeResult.success ? undefined : codeResult.text,
      costUsd: codeResult.costUsd,
      tokenCount: codeResult.tokenUsage
        ? codeResult.tokenUsage.inputTokens + codeResult.tokenUsage.outputTokens
        : undefined,
      durationMs: codeResult.durationMs,
    });

    if (!codeResult.success) {
      throw new Error(`Coding failed: ${codeResult.text.slice(0, 500)}`);
    }

    emit({ type: 'log', level: 'info', message: `Code generated. Modified files: ${codeResult.modifiedFiles.join(', ') || 'none detected'}` });
    if (codeResult.costUsd) {
      emit({ type: 'log', level: 'info', message: `Cost: $${codeResult.costUsd.toFixed(4)}` });
    }
    emit({ type: 'attempt_complete', attemptNum: 1, success: true });

    // 5. Verification phase (STUB for Phase 1c)
    updateTaskStatus(taskId, 'verifying');
    emit({ type: 'status_change', status: 'verifying', message: 'Verification will be implemented in Phase 1c. Skipping...' });
    emit({ type: 'log', level: 'warn', message: 'Verification not yet implemented — marking as completed without verification' });

    recordEvent(taskId, 'verification_spec', { spec: plan.verificationSpec });

    // 6. Complete
    updateTaskStatus(taskId, 'completed', {
      summary: plan.summary,
      modifiedFiles: codeResult.modifiedFiles,
      costUsd: codeResult.costUsd,
      verificationSkipped: true,
    });

    emit({ type: 'task_complete', success: true, summary: `Completed: ${plan.summary}. ${codeResult.modifiedFiles.length} files modified. Verification pending (Phase 1c).` });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    emit({ type: 'log', level: 'error', message: errorMessage });
    emit({ type: 'task_complete', success: false, summary: `Failed: ${errorMessage}` });

    updateTaskStatus(taskId, 'failed', { error: errorMessage });
    recordEvent(taskId, 'pipeline_error', { error: errorMessage });
  }
}

function updateTaskStatus(taskId: string, status: TaskStatus, result?: Record<string, unknown>): void {
  const update: Record<string, unknown> = {
    status,
    updatedAt: new Date().toISOString(),
  };
  if (result) {
    update.result = JSON.stringify(result);
  }
  db.update(tasks).set(update).where(eq(tasks.id, taskId)).run();
}

function recordAttempt(
  taskId: string,
  attemptNum: number,
  agentId: string,
  phase: 'planning' | 'coding' | 'verifying',
  status: 'running' | 'success' | 'error',
  data?: {
    input?: unknown;
    output?: unknown;
    errorLog?: string;
    costUsd?: number;
    tokenCount?: number;
    durationMs?: number;
  },
): void {
  db.insert(attempts).values({
    id: nanoid(),
    taskId,
    attemptNum,
    agentId,
    phase,
    status,
    input: data?.input ? JSON.stringify(data.input) : null,
    output: data?.output ? JSON.stringify(data.output) : null,
    errorLog: data?.errorLog ?? null,
    errorHash: null,
    costUsd: data?.costUsd ?? null,
    tokenCount: data?.tokenCount ?? null,
    durationMs: data?.durationMs ?? null,
    createdAt: new Date().toISOString(),
  }).run();
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
