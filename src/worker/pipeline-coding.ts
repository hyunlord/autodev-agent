import { db } from '../lib/db/client';
import { attempts } from '../lib/db/schema';
import { nanoid } from 'nanoid';
import { PluginRegistry } from '../lib/plugins/registry';
import { selectAlternativeAgent } from '../lib/agent-selector';
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
  const { loadPromptLibrary: _loadCodingLib, getPromptsForStage: _getCodingStage } = await import('../lib/harness/prompt-library');
  const _codePromptLib = _loadCodingLib(projectDir);

  // K5: Skills for coding stage (loaded once outside retry loop)
  const { loadSkillIndex: _loadSkills, activateSkills: _activateSkills, getSkillPromptsForStage: _getSkillPrompts } = await import('../lib/harness/skills-loader');
  const _codingSkillIndex = _loadSkills(projectDir);
  const _codingActiveSkills = _activateSkills(_codingSkillIndex, {
    projectType: projectConfig?.type,
    taskCategory: currentPlan.taskCategory,
    files: currentPlan.estimatedFiles,
  }, projectDir);
  const _skillCoding = _getSkillPrompts(_codingActiveSkills, 'coding');

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
  let consecutiveVerifyFails = 0; // J6: 연속 검증 실패 카운터
  let lastSuggestions: string[] = [];

  // ─── Parallel branch (H4): Plan에 subTasks가 있으면 병렬 실행 ───
  // subTasks가 없으면 100% 기존 단일 실행 경로로 폴백.
  if (currentPlan.subTasks && currentPlan.subTasks.length > 0) {
    const { executeParallelCoding } = await import('./pipeline-parallel');

    emit({
      type: 'log',
      level: 'info',
      message: `[Parallel] Plan has ${currentPlan.subTasks.length} sub-tasks — using parallel coding execution`,
    });

    updateTaskStatus(taskId, 'coding');
    emit({ type: 'status_change', status: 'coding', message: `Running ${currentPlan.subTasks.length} sub-tasks in parallel...` });
    emit({ type: 'attempt_start', attemptNum: 1, agentId: 'parallel' });

    const parallelResults = await executeParallelCoding({
      subTasks: currentPlan.subTasks,
      projectDir,
      systemPrompt,
      workspaceContext,
      emit,
      signal,
      costPreference: _codeTaskCfg.costPreference,
      hookEngine,
      taskId,
    });

    // 결과 합산
    const allModifiedFiles = filterToolArtifacts(parallelResults.flatMap((r) => r.modifiedFiles));
    const totalParallelCost = parallelResults.reduce((sum, r) => sum + r.costUsd, 0);
    const totalParallelInputTokens = parallelResults.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalParallelOutputTokens = parallelResults.reduce((sum, r) => sum + r.outputTokens, 0);
    const allSuccess = parallelResults.length > 0 && parallelResults.every((r) => r.success);
    const parallelDurationMs = Date.now() - startTime;

    // 각 sub-task를 개별 attempts row로 기록 (비용/토큰 추적)
    for (const r of parallelResults) {
      db.insert(attempts).values({
        id: nanoid(),
        taskId,
        attemptNum: 1,
        agentId: r.agentId || 'parallel',
        phase: 'coding',
        status: r.success ? 'success' : 'error',
        input: JSON.stringify({ subTaskId: r.subTaskId }),
        output: JSON.stringify({
          text: r.text.slice(0, 5000),
          modifiedFiles: r.modifiedFiles,
          costUsd: r.costUsd,
        }),
        errorLog: r.success ? null : r.text.slice(0, 5000),
        errorHash: null,
        costUsd: r.costUsd,
        tokenCount: r.inputTokens + r.outputTokens,
        durationMs: r.durationMs,
        createdAt: new Date().toISOString(),
      }).run();
    }

    totalCostUsd += totalParallelCost;
    emit({
      type: 'cost_update',
      attemptNum: 1,
      costUsd: totalParallelCost,
      totalCostUsd,
      inputTokens: totalParallelInputTokens,
      outputTokens: totalParallelOutputTokens,
      agentId: 'parallel',
    });

    lastModifiedFiles = allModifiedFiles;
    emit({
      type: 'log',
      level: 'info',
      message: `[Parallel] Done — ${parallelResults.length} sub-tasks (${parallelResults.filter((r) => r.success).length} success), ${allModifiedFiles.length} files, $${totalParallelCost.toFixed(4)}`,
    });
    emit({ type: 'attempt_complete', attemptNum: 1, success: allSuccess });

    // 병렬 실행이 모두 실패하면 verification 건너뛰고 즉시 실패 반환
    if (!allSuccess && allModifiedFiles.length === 0) {
      const failedSubTasks = parallelResults.filter((r) => !r.success);
      return {
        success: false,
        lastModifiedFiles,
        totalCostUsd,
        attemptCount: 1,
        retryAttempts: [],
        lastFailedChecks: failedSubTasks.map((r) => ({
          id: r.subTaskId,
          description: `Sub-task ${r.subTaskId} failed`,
          actual: r.text.slice(0, 500),
        })),
        stopReason: 'parallel_all_failed',
        hookContextAccumulator,
        agentId: 'parallel',
      };
    }

    // ─── Verification phase (병렬 결과 전체에 대해 1회) ─────
    updateTaskStatus(taskId, 'verifying');
    emit({ type: 'status_change', status: 'verifying', message: `Verifying parallel results...` });

    // executeVerification은 단일 codingAttemptId를 받음 — 대표 attempt row 생성
    const parallelCodingAttemptId = nanoid();
    db.insert(attempts).values({
      id: parallelCodingAttemptId,
      taskId,
      attemptNum: 1,
      agentId: 'parallel',
      phase: 'coding',
      status: allSuccess ? 'success' : 'error',
      input: JSON.stringify({ subTaskCount: parallelResults.length }),
      output: JSON.stringify({
        modifiedFiles: allModifiedFiles,
        costUsd: totalParallelCost,
        successCount: parallelResults.filter((r) => r.success).length,
      }),
      errorLog: null,
      errorHash: null,
      costUsd: totalParallelCost,
      tokenCount: totalParallelInputTokens + totalParallelOutputTokens,
      durationMs: parallelDurationMs,
      createdAt: new Date().toISOString(),
    }).run();

    const verifyPhaseResult = await executeVerification({
      taskId, projectDir, projectConfig, task, currentPlan,
      lastModifiedFiles, attempt: 1, codingAttemptId: parallelCodingAttemptId,
      useVerifyAgent, verifyAgent, lastVerdict, lastIssues, lastSuggestions,
      hookEngine, hookContextAccumulator, totalCostUsd,
      mcpManager: params.mcpManager,
      signal, emit,
    });

    totalCostUsd = verifyPhaseResult.totalCostUsd;
    hookContextAccumulator = verifyPhaseResult.hookContextAccumulator;

    if (verifyPhaseResult.breakLoop) {
      return {
        success: false,
        lastModifiedFiles,
        totalCostUsd,
        attemptCount: 1,
        retryAttempts: [],
        lastFailedChecks: verifyPhaseResult.lastFailedChecks,
        replanFeedback: verifyPhaseResult.replanFeedback,
        hookContextAccumulator,
        agentId: 'parallel',
      };
    }

    return {
      success: verifyPhaseResult.allPassed,
      lastModifiedFiles,
      totalCostUsd,
      attemptCount: 1,
      retryAttempts: [],
      lastFailedChecks: verifyPhaseResult.lastFailedChecks,
      stopReason: verifyPhaseResult.allPassed ? undefined : 'parallel_verification_failed',
      hookContextAccumulator,
      agentId: 'parallel',
    };
  }
  // ─── End parallel branch ─────────────────────────────

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
    const _codingCustom = _getCodingStage(_codePromptLib, 'coding');
    if (_codingCustom) {
      codingPrompt += _codingCustom;
    }
    // K5: Skills injection for coding stage
    if (_skillCoding) {
      codingPrompt += _skillCoding;
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
    emit({ type: 'log', level: 'info', message: `Coder prompt: ${coderPrompt.source}${coderPrompt.filePath ? ` (${coderPrompt.filePath})` : ' (built-in)'} [v${coderPrompt.version}]` });

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
    // K4: prompt version tracking
    const _codingPromptVersions = JSON.stringify({
      coder: coderPrompt.version,
      skillsActive: _codingActiveSkills.filter(s => s._loaded).map(s => `${s.id}:${s.version}`),
    });
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
      promptVersions: _codingPromptVersions,
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
      consecutiveVerifyFails = 0;
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
    consecutiveVerifyFails++;

    // J6: 연속 2회 검증 실패 시 에이전트 교체
    if (consecutiveVerifyFails >= 2) {
      const alt = await selectAlternativeAgent(agentId, [], _codeTaskCfg.costPreference);
      if (alt) {
        const fromAgent = agentId;
        const failCount = consecutiveVerifyFails;
        agent = alt.agent;
        agentId = alt.agentId;
        consecutiveVerifyFails = 0;
        emit({
          type: 'agent_switch',
          fromAgent,
          toAgent: agentId,
          reason: `${failCount} consecutive verification failures`,
          attemptNum: attempt,
        });
        emit({
          type: 'log',
          level: 'info',
          message: `[J6] Agent switched: ${fromAgent} → ${agentId} (${failCount} consecutive verify failures)`,
        });
        // K9: AgentSwitch hook
        hookEngine.execute({
          event: 'AgentSwitch', taskId, projectDir,
          fromAgent, toAgent: agentId,
          reason: `${failCount} consecutive verification failures`,
        }, emit).catch(() => {});
      }
    }

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
