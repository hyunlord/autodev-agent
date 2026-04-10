import { db } from '../lib/db/client';
import { attempts, verifications } from '../lib/db/schema';
import { nanoid } from 'nanoid';
import { join } from 'path';
import type { ProjectConfig } from '../lib/detection/project-type';
import type { HookEngine } from '../lib/hooks/hook-engine';
import type { EmitFn } from './pipeline-types';
import { checkAbort } from './pipeline-types';
import type { Plan } from './planning';
import type { TaskStatus } from '../lib/types';
import type { McpManager } from '../lib/harness/mcp-manager';
import type { VerificationDepth } from '../agents/verify/verify-agent';

// ─── I2: Progressive depth selection ─────────────────────────
/**
 * 재시도 횟수에 따라 verification depth 자동 조절.
 * - 첫 시도: fast (<30s — 빌드+파일 체크만)
 * - 재시도 1-2: standard (+ Playwright/VLM)
 * - 재시도 3+: deep (+ SAST/A11y/LLM 판정)
 */
export function selectVerificationDepth(attempt: number): VerificationDepth {
  if (attempt <= 1) return 'fast';
  if (attempt <= 2) return 'standard';
  return 'deep';
}

export interface VerifyPhaseResult {
  allPassed: boolean;
  lastVerdict: string;
  lastIssues: string[];
  lastSuggestions: string[];
  lastFailedChecks: Array<{ id: string; description: string; actual?: string; expected?: string; type?: string; filePath?: string }>;
  lastPassedChecks: Array<{ description: string }>;
  costUsd: number;
  hookContextAccumulator: string;
  totalCostUsd: number;
  replanFeedback?: { issues: string[]; suggestions: string[]; previousSummary: string };
  /** If true, the caller should break out of the coding retry loop (re-plan verdict). */
  breakLoop?: boolean;
}

/**
 * Execute the verification phase: PreVerify hook → Verify Agent or legacy verification → DB insert → PostVerify hook.
 * Extracted from runSingleCycle lines 1046-1202.
 */
export async function executeVerification(params: {
  taskId: string;
  projectDir: string;
  projectConfig: ProjectConfig | null;
  task: any;
  currentPlan: Plan;
  lastModifiedFiles: string[];
  attempt: number;
  codingAttemptId: string;
  useVerifyAgent: boolean;
  verifyAgent: any;
  lastVerdict: string;
  lastIssues: string[];
  lastSuggestions: string[];
  hookEngine: HookEngine;
  hookContextAccumulator: string;
  totalCostUsd: number;
  mcpManager?: McpManager;
  signal?: AbortSignal;
  emit: EmitFn;
}): Promise<VerifyPhaseResult> {
  const {
    taskId, projectDir, projectConfig, task, currentPlan,
    lastModifiedFiles, attempt, codingAttemptId, useVerifyAgent,
    verifyAgent, hookEngine, signal, emit,
  } = params;
  let { lastVerdict, lastIssues, lastSuggestions, hookContextAccumulator, totalCostUsd } = params;

  // MCP 도구 수집 (있으면)
  let mcpVerifyTools: import('../agents/interfaces').VerifyTool[] = [];
  if (params.mcpManager) {
    const { mcpToolsAsVerifyTools } = await import('../lib/mcp/mcp-tool-provider');
    mcpVerifyTools = mcpToolsAsVerifyTools(params.mcpManager.getMcpClient(), ['playwright']);
  }

  // ─── Verification phase ──────────────────────────
  checkAbort(signal);
  // Status updates are handled by caller (updateTaskStatus)

  // ─── PreVerify hook ─────────────────────────────────
  {
    const preVerifyHooks = await hookEngine.execute(
      { event: 'PreVerify', taskId, projectDir, modifiedFiles: lastModifiedFiles, agentId: '' },
      emit,
    );
    if (preVerifyHooks.mergedContext) {
      hookContextAccumulator += (hookContextAccumulator ? '\n' : '') + preVerifyHooks.mergedContext;
    }
  }

  const screenshotDir = join(process.cwd(), '.autodev', 'screenshots', taskId, `attempt-${attempt}`);
  let verifyResult: any;
  let replanFeedback: { issues: string[]; suggestions: string[]; previousSummary: string } | undefined;
  let breakLoop = false;
  let lastFailedChecks: Array<{ id: string; description: string; actual?: string; expected?: string; type?: string; filePath?: string }> = [];
  let lastPassedChecks: Array<{ description: string }> = [];

  // ─── Dev Mode preset ──────────────────────────────────
  const { getPresetById: _getPresetV, detectPresetFromProject: _detectPresetV } = await import('../lib/presets/dev-mode-presets');
  const _verifyTaskCfg = typeof task.config === 'string' ? JSON.parse(task.config ?? '{}') : (task.config ?? {});
  const _verifyDevPreset = (_verifyTaskCfg.devMode ? _getPresetV(_verifyTaskCfg.devMode) : undefined) ?? _detectPresetV(projectConfig);
  const { loadPromptLibrary: _loadVerifyLib, getPromptsForStage: _getVerifyStage } = await import('../lib/harness/prompt-library');
  const _verifyCustom = _getVerifyStage(_loadVerifyLib(projectDir), 'verification');

  if (useVerifyAgent) {
    // ─── I2: Select progressive verification depth ────
    const verifyDepth = selectVerificationDepth(attempt);
    emit({ type: 'log', level: 'info', message: `[Verify] Progressive depth: ${verifyDepth} (attempt ${attempt})` });

    // ─── NEW: LLM-based Verify Agent ────────────────
    const verifyOutput = await verifyAgent.invoke({
      depth: verifyDepth,
      prompt: 'Verify the coding result',
      originalPrompt: (() => {
        let p = task.prompt;
        if (_verifyDevPreset) p += `\n\n## Dev Mode Verification Hints\n${_verifyDevPreset.verifyHints}`;
        if (_verifyCustom) p += _verifyCustom;
        if (attempt > 1 && lastIssues.length > 0) {
          p += `\n\nPREVIOUS ATTEMPT reported these issues (verify independently — they may be fixed now):\n- ${lastIssues.join('\n- ')}`;
        }
        return p;
      })(),
      modifiedFiles: lastModifiedFiles,
      projectDir,
      tools: mcpVerifyTools,
      context: {
        projectDir,
        projectType: projectConfig?.type,
        files: lastModifiedFiles,
        verifyFeedback: attempt > 1 ? {
          previousVerdict: lastVerdict,
          issues: lastIssues,
          suggestions: lastSuggestions,
          attemptCount: attempt,
        } : undefined,
      },
      config: { timeoutMs: 120_000 },
      onProgress: emit,
    } as any);

    const vr = verifyOutput.result as any;
    totalCostUsd += verifyOutput.costUsd;

    emit({
      type: 'cost_update',
      attemptNum: attempt,
      costUsd: verifyOutput.costUsd,
      totalCostUsd,
      inputTokens: verifyOutput.tokenUsage?.input ?? 0,
      outputTokens: verifyOutput.tokenUsage?.output ?? 0,
      agentId: verifyAgent.id,
    });

    // Save verify agent result to attempts table
    db.insert(attempts).values({
      id: nanoid(),
      taskId,
      attemptNum: attempt,
      agentId: verifyAgent.id,
      phase: 'verifying',
      status: vr.passed ? 'success' : 'error',
      input: JSON.stringify({ originalPrompt: task.prompt?.slice(0, 1000) }),
      output: JSON.stringify(vr),
      errorLog: vr.passed ? null : (vr.reason ?? '').slice(0, 5000),
      errorHash: null,
      costUsd: verifyOutput.costUsd,
      tokenCount: (verifyOutput.tokenUsage?.input ?? 0) + (verifyOutput.tokenUsage?.output ?? 0),
      durationMs: verifyOutput.durationMs,
      createdAt: new Date().toISOString(),
    }).run();

    // Convert to legacy format for DB compatibility
    verifyResult = {
      allPassed: vr.passed,
      results: [{
        checkId: 'verify-agent',
        type: 'llm_verify',
        status: vr.passed ? 'pass' : 'fail',
        description: vr.reason,
        expected: 'Requirements met',
        actual: `Score: ${vr.score}/100 — ${vr.reason}`,
        durationMs: verifyOutput.durationMs,
      }],
      consoleErrors: vr.evidence?.consoleErrors ?? [],
    };

    // Force re-plan if same verdict repeats — different approach needed
    if (lastVerdict === 're-code' && vr.verdict === 're-code' && attempt >= 2) {
      emit({ type: 'log', level: 'warn', message: '[Pipeline] Same re-code verdict repeated — forcing re-plan' });
      vr.verdict = 're-plan';
    }

    // Detect likely hallucination: same "file path in CSS/media" pattern repeated across attempts
    if (vr.verdict === 're-code' && attempt > 1 && lastIssues.length > 0) {
      const filePathPattern = /file path|path.*@media|@media.*path/i;
      const newHas = vr.issues?.some((i: string) => filePathPattern.test(i));
      const oldHas = lastIssues.some(i => filePathPattern.test(i));
      if (newHas && oldHas) {
        emit({ type: 'log', level: 'warn', message: '[Verify] WARNING: "file path in @media" issue repeated across attempts — possible Verify Agent hallucination. Check ~/.autodev/debug/verify-*.txt for diagnosis.' });
      }
    }

    // Track verdict for retry
    lastVerdict = vr.verdict;
    lastIssues = vr.issues ?? [];
    lastSuggestions = vr.suggestions ?? [];

    emit({ type: 'log', level: vr.passed ? 'info' : 'warn',
      message: `[Verify Agent] ${(vr.verdict ?? 'unknown').toUpperCase()} — Score: ${vr.score}/100 — ${vr.reason}` });

    // Handle re-plan verdict
    if (vr.verdict === 're-plan') {
      emit({ type: 'log', level: 'warn', message: `[Verify Agent] Re-plan needed (score: ${vr.score}). Will regenerate plan.` });
      replanFeedback = {
        issues: vr.issues ?? [],
        suggestions: vr.suggestions ?? [],
        previousSummary: currentPlan.summary,
      };
      breakLoop = true;
    }
  } else {
    // ─── LEGACY: mechanical verification ────────────
    const { runVerification } = await import('./verification');
    verifyResult = await runVerification(
      currentPlan.verificationSpec,
      projectDir,
      projectConfig,
      screenshotDir,
      emit,
    );
  }

  // ─── DB insert for verification results ────────────
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

  // ─── PostVerify hook ────────────────────────────────
  {
    const postVerifyHooks = await hookEngine.execute(
      { event: 'PostVerify', taskId, projectDir, verifyResult: { allPassed: verifyResult.allPassed }, attempt },
      emit,
    );
    if (postVerifyHooks.finalDecision === 'deny' && postVerifyHooks.mergedIssues.length > 0) {
      lastFailedChecks = [
        ...lastFailedChecks,
        ...postVerifyHooks.mergedIssues.map((issue, i) => ({ id: `hook-verify-${i}`, description: issue })),
      ];
    }
    if (postVerifyHooks.mergedContext) {
      hookContextAccumulator += (hookContextAccumulator ? '\n' : '') + postVerifyHooks.mergedContext;
    }
  }

  // ─── Extract failed/passed checks ────────────────────
  if (!verifyResult.allPassed && !breakLoop) {
    const failedChecks = verifyResult.results.filter((r: any) => r.status === 'fail');
    lastFailedChecks = [
      ...lastFailedChecks,
      ...failedChecks.map((r: any) => ({
        id: r.checkId,
        description: r.description,
        actual: r.actual,
        expected: r.expected ?? currentPlan.verificationSpec.steps.find((s: any) => s.id === r.checkId)?.expectedText,
        type: r.type ?? currentPlan.verificationSpec.steps.find((s: any) => s.id === r.checkId)?.type,
        filePath: currentPlan.verificationSpec.steps.find((s: any) => s.id === r.checkId)?.filePath,
      })),
    ];
    lastPassedChecks = verifyResult.results
      .filter((r: any) => r.status === 'pass')
      .map((r: any) => ({ description: r.description }));
  }

  return {
    allPassed: verifyResult.allPassed,
    lastVerdict,
    lastIssues,
    lastSuggestions,
    lastFailedChecks,
    lastPassedChecks,
    costUsd: verifyResult.allPassed ? 0 : 0, // individual cost tracked in totalCostUsd
    hookContextAccumulator,
    totalCostUsd,
    replanFeedback,
    breakLoop,
  };
}
