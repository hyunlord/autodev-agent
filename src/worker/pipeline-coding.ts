import { db } from '../lib/db/client';
import { attempts } from '../lib/db/schema';
import { nanoid } from 'nanoid';
import { PluginRegistry } from '../lib/plugins/registry';
import { loadPrompt } from '../lib/harness/prompt-loader';
import { RetryController } from './retry';
import { executeVerification } from './pipeline-verify';
import { checkAbort } from './pipeline-types';
import type { EmitFn } from './pipeline-types';
import type { HookEngine } from '../lib/hooks/hook-engine';
import type { Plan } from './planning';
import type { AutoDevConfig } from '../lib/config';
import type { McpServerInfo } from '../lib/plugins/interfaces';
import type { ProjectConfig } from '../lib/detection/project-type';
import type { TaskStatus } from '../lib/types';
import type { McpManager } from '../lib/harness/mcp-manager';

export interface CodingLoopResult {
  success: boolean;
  lastModifiedFiles: string[];
  totalCostUsd: number;
  attemptCount: number;
  retryAttempts: any[];
  lastFailedChecks: any[];
  stopReason?: string;
  replanFeedback?: { issues: string[]; suggestions: string[]; previousSummary: string };
  hookContextAccumulator: string;
  /** Updated agentId (may change on strategy_change). */
  agentId: string;
}

const TOOL_ARTIFACTS = ['.omc/', '.omx/', '.opencode/', '.autodev/', '.git/', '.DS_Store'];

function filterToolArtifacts(files: string[]): string[] {
  return files.filter(f => !TOOL_ARTIFACTS.some(prefix => f.startsWith(prefix)) && f !== '.DS_Store');
}

/**
 * Execute the coding retry loop: for each attempt, invoke the coding agent then run verification.
 * Extracted from runSingleCycle lines 851-1258.
 */
export async function executeCodingLoop(params: {
  taskId: string;
  projectDir: string;
  projectConfig: ProjectConfig | null;
  task: any;
  currentPlan: Plan;
  workspaceContext: string;
  systemPrompt: string | null;
  agentId: string;
  agent: any;
  verifyAgent: any;
  useVerifyAgent: boolean;
  codingMcpServers: McpServerInfo[];
  codingMcpPrompt: string;
  verifyMcpPrompt: string;
  config: AutoDevConfig;
  hookEngine: HookEngine;
  hookContextAccumulator: string;
  totalCostUsd: number;
  signal?: AbortSignal;
  projectHistory?: Array<{ prompt: string; status: string; result: any; createdAt: string }>;
  mcpManager?: McpManager;
  emit: EmitFn;
  updateTaskStatus: (taskId: string, status: TaskStatus, result?: Record<string, unknown>) => void;
  startTime: number;
}): Promise<CodingLoopResult> {
  const {
    taskId, projectDir, projectConfig, task, currentPlan, workspaceContext,
    systemPrompt, config, hookEngine, signal, emit, updateTaskStatus, startTime,
  } = params;
  let { agentId, agent, hookContextAccumulator, totalCostUsd } = params;
  const { codingMcpServers, codingMcpPrompt, verifyMcpPrompt, useVerifyAgent, verifyAgent } = params;
  const projectHistory = params.projectHistory ?? [];

  // ─── Dev Mode preset ──────────────────────────────────
  const { getPresetById: _getPresetC, detectPresetFromProject: _detectPresetC } = await import('../lib/presets/dev-mode-presets');
  const _codeTaskCfg = typeof task.config === 'string' ? JSON.parse(task.config ?? '{}') : (task.config ?? {});
  const _codeDevPreset = (_codeTaskCfg.devMode ? _getPresetC(_codeTaskCfg.devMode) : undefined) ?? _detectPresetC(projectConfig);

  // ─── Reset retry state for this plan ───────────────────
  const retryCtrl = new RetryController({
    maxAttempts: config.maxRetries,
    timeBudgetMs: 300_000,
    tokenBudget: 100_000,
  });

  let lastModifiedFiles: string[] = [];
  let lastFailedChecks: Array<{ id: string; description: string; actual?: string; expected?: string; type?: string; filePath?: string }> = [];
  let lastPassedChecks: Array<{ description: string }> = [];
  let lastVerdict = '';
  let lastIssues: string[] = [];
  let lastSuggestions: string[] = [];

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    const isRetry = attempt > 1;
    if (isRetry) {
      updateTaskStatus(taskId, 'retrying');
      emit({ type: 'status_change', status: 'retrying', message: `Retry attempt ${attempt}/${config.maxRetries}...` });

      // ─── OnRetry hook ───────────────────────────────────
      const onRetryHooks = await hookEngine.execute(
        { event: 'OnRetry', taskId, projectDir, attempt, previousIssues: lastFailedChecks.map(c => c.description) },
        emit,
      );
      if (onRetryHooks.mergedContext) {
        hookContextAccumulator += (hookContextAccumulator ? '\n' : '') + onRetryHooks.mergedContext;
      }
    } else {
      updateTaskStatus(taskId, 'coding');
    }

    checkAbort(signal);
    emit({ type: 'status_change', status: 'coding', message: isRetry ? `Retrying with error context (attempt ${attempt})...` : `Sending task to ${agent.name}...` });
    emit({ type: 'attempt_start', attemptNum: attempt, agentId });

    let codingPrompt = `${systemPrompt ? systemPrompt + '\n\n' : ''}CRITICAL: You MUST only create and modify files inside this directory: ${projectDir}
Do NOT navigate to or modify files outside this directory.
Do NOT search for or modify any files in parent directories.
Your working directory is ${projectDir} — all file paths must be relative to this directory.

${currentPlan.codingPrompt}`;
    if (workspaceContext) {
      codingPrompt = codingPrompt + `\n\n${workspaceContext}`;
    }
    if (_codeDevPreset) {
      codingPrompt += `\n\n## Dev Mode: ${_codeDevPreset.name}\n${_codeDevPreset.codingHints}`;
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
      const retryContext = retryCtrl.buildRetryContext(lastFailedChecks, lastPassedChecks);
      codingPrompt = `${currentPlan.codingPrompt}\n\n---\n\n${retryContext}`;
      emit({ type: 'log', level: 'info', message: `Retry context: ${lastFailedChecks.length} failed, ${lastPassedChecks.length} passed checks from previous attempt` });
    }
    if (isRetry && useVerifyAgent && lastIssues.length > 0) {
      // ISOLATION: issues/suggestions만 전달 — score/verdict는 제외
      // Coding Agent가 "85점이니까 조금만 고치면 되겠지" 합리화 방지
      codingPrompt += `\n\n---\n\nPrevious attempt had these issues:\n${lastIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}`;
      if (lastSuggestions.length > 0) {
        codingPrompt += `\n\nSuggestions:\n${lastSuggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
      }
      codingPrompt += `\n\nFix these issues. Do NOT rewrite everything.`;
    }

    const coderPrompt = loadPrompt('coder', projectDir, { projectDir });
    emit({ type: 'log', level: 'info', message: `Coder prompt: ${coderPrompt.source}${coderPrompt.filePath ? ` (${coderPrompt.filePath})` : ' (built-in)'}` });

    // Inject accumulated hook context into coding prompt
    if (hookContextAccumulator) {
      codingPrompt += `\n\n## Additional Context (Hook)\n${hookContextAccumulator}`;
    }

    const safePrompt = `${coderPrompt.content}${codingMcpPrompt ? '\n' + codingMcpPrompt : ''}\n\n${codingPrompt}`;

    if (verifyMcpPrompt) {
      emit({ type: 'log', level: 'info', message: `Verification MCP tools available` });
    }

    // ─── PreCode hook ───────────────────────────────────
    {
      const preCodeHooks = await hookEngine.execute(
        { event: 'PreCode', taskId, projectDir, plan: { summary: currentPlan.summary }, agentId, attempt },
        emit,
      );
      if (preCodeHooks.mergedContext) {
        hookContextAccumulator += (hookContextAccumulator ? '\n' : '') + preCodeHooks.mergedContext;
      }
    }

    const codeResult = await agent.invoke({
      task: safePrompt,
      projectDir,
      maxTurns: 20,
      timeoutMs: 300_000,
      mcpServers: codingMcpServers.length > 0 ? codingMcpServers : undefined,
      onProgress: (event: any) => emit(event),
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

    emit({
      type: 'cost_update',
      attemptNum: attempt,
      costUsd: codeResult.costUsd ?? 0,
      totalCostUsd,
      inputTokens: codeResult.tokenUsage?.inputTokens ?? 0,
      outputTokens: codeResult.tokenUsage?.outputTokens ?? 0,
      agentId,
    });

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
          lastModifiedFiles,
          totalCostUsd,
          attemptCount: attempt,
          retryAttempts: retryCtrl.attempts,
          lastFailedChecks: [{ id: 'coding', description: 'Coding agent returned error', actual: errorMsg }],
          stopReason: reason,
          hookContextAccumulator,
          agentId,
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

    // ─── PostCode hook ──────────────────────────────────
    {
      const postCodeHooks = await hookEngine.execute(
        { event: 'PostCode', taskId, projectDir, modifiedFiles: lastModifiedFiles, agentId, attempt,
          codingResult: { success: codeResult.success, costUsd: codeResult.costUsd, durationMs: codeResult.durationMs } },
        emit,
      );
      if (postCodeHooks.finalDecision === 'deny' && postCodeHooks.mergedIssues.length > 0) {
        // Hook vetoed the code — inject issues into retry context
        lastFailedChecks = [
          ...lastFailedChecks,
          ...postCodeHooks.mergedIssues.map((issue, i) => ({ id: `hook-${i}`, description: issue })),
        ];
        emit({ type: 'log', level: 'warn', message: `[Hook] PostCode denied — issues will be included in retry context` });
      }
      if (postCodeHooks.mergedContext) {
        hookContextAccumulator += (hookContextAccumulator ? '\n' : '') + postCodeHooks.mergedContext;
      }
    }

    // ─── Verification phase ──────────────────────────
    updateTaskStatus(taskId, 'verifying');
    emit({ type: 'status_change', status: 'verifying', message: `Verifying (attempt ${attempt})...` });

    const verifyPhaseResult = await executeVerification({
      taskId, projectDir, projectConfig, task, currentPlan,
      lastModifiedFiles, attempt, codingAttemptId, useVerifyAgent,
      verifyAgent, lastVerdict, lastIssues, lastSuggestions,
      hookEngine, hookContextAccumulator, totalCostUsd,
      mcpManager: params.mcpManager,
      signal, emit,
    });

    // Update state from verification
    lastVerdict = verifyPhaseResult.lastVerdict;
    lastIssues = verifyPhaseResult.lastIssues;
    lastSuggestions = verifyPhaseResult.lastSuggestions;
    hookContextAccumulator = verifyPhaseResult.hookContextAccumulator;
    totalCostUsd = verifyPhaseResult.totalCostUsd;

    // Handle re-plan verdict (break out of retry loop)
    if (verifyPhaseResult.breakLoop) {
      return {
        success: false,
        lastModifiedFiles,
        totalCostUsd,
        attemptCount: attempt,
        retryAttempts: retryCtrl.attempts,
        lastFailedChecks: verifyPhaseResult.lastFailedChecks,
        replanFeedback: verifyPhaseResult.replanFeedback,
        hookContextAccumulator,
        agentId,
      };
    }

    if (verifyPhaseResult.allPassed) {
      return {
        success: true,
        lastModifiedFiles,
        totalCostUsd,
        attemptCount: attempt,
        retryAttempts: retryCtrl.attempts,
        lastFailedChecks: [],
        hookContextAccumulator,
        agentId,
      };
    }

    // Verification failed — update state for retry
    lastFailedChecks = verifyPhaseResult.lastFailedChecks;
    lastPassedChecks = verifyPhaseResult.lastPassedChecks;

    const failSummary = lastFailedChecks.map(c => c.description).join('; ');
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
        lastModifiedFiles,
        totalCostUsd,
        attemptCount: attempt,
        retryAttempts: retryCtrl.attempts,
        lastFailedChecks,
        stopReason: reason,
        hookContextAccumulator,
        agentId,
      };
    }

    emit({ type: 'log', level: 'info', message: `Will retry (${reason ?? 'checks failed'})...` });
  }
  // ─── End of coding retry loop ─────────────────────────

  // All retries exhausted without success or re-plan
  return {
    success: false,
    lastModifiedFiles,
    totalCostUsd,
    attemptCount: config.maxRetries,
    retryAttempts: retryCtrl.attempts,
    lastFailedChecks,
    stopReason: 'max_attempts',
    hookContextAccumulator,
    agentId,
  };
}
