import { isAbsolute } from 'path';
import { generatePlan, type PlanResult, type Plan } from './planning';
import type { ProjectConfig } from '../lib/detection/project-type';
import type { HookEngine } from '../lib/hooks/hook-engine';
import type { EmitFn } from './pipeline-types';
import type { PlanningMode } from '../lib/types';

export interface PlanningPhaseResult {
  planResult: PlanResult;
  hookContextAccumulator: string;
}

/**
 * Execute the full planning phase: PrePlan hook → plan generation (normal or debate) → PostPlan hook.
 * Extracted from runSingleCycle lines 430-539.
 */
export async function executePlanning(params: {
  taskId: string;
  projectDir: string;
  projectConfig: ProjectConfig | null;
  workspaceContext: string;
  systemPrompt: string | null;
  task: any;
  taskConfig: Record<string, any>;
  hookEngine: HookEngine;
  hookContextAccumulator: string;
  emit: EmitFn;
}): Promise<PlanningPhaseResult> {
  const { taskId, projectDir, projectConfig, workspaceContext, systemPrompt, task, taskConfig, hookEngine, emit } = params;
  let hookContextAccumulator = params.hookContextAccumulator;

  // ─── PrePlan hook ──────────────────────────────────────
  {
    const prePlanHooks = await hookEngine.execute(
      { event: 'PrePlan', taskId, projectDir, prompt: task.prompt },
      emit,
    );
    if (prePlanHooks.mergedContext) {
      hookContextAccumulator += (hookContextAccumulator ? '\n' : '') + prePlanHooks.mergedContext;
    }
  }

  // ─── Plan generation ──────────────────────────────────
  let planResult: PlanResult;
  const planMode = (task.planningMode ?? 'auto') as PlanningMode;

  // ─── Dev Mode preset injection ─────────────────────────
  const { getPresetById: _getPreset, detectPresetFromProject: _detectPreset } = await import('../lib/presets/dev-mode-presets');
  const _planTaskCfg = typeof task.config === 'string' ? JSON.parse(task.config ?? '{}') : (task.config ?? {});
  const _planDevPreset = (_planTaskCfg.devMode ? _getPreset(_planTaskCfg.devMode) : undefined) ?? _detectPreset(projectConfig);
  let effectiveWorkspaceContext = _planDevPreset
    ? `${workspaceContext}\n\n## Dev Mode: ${_planDevPreset.name}\n${_planDevPreset.planningHints}`
    : workspaceContext;
  if (_planDevPreset) {
    emit({ type: 'log', level: 'info', message: `Dev Mode preset: ${_planDevPreset.name}` });
  }

  // ─── Prompt Library injection (K6: index-only for planning) ──
  const { loadPromptLibrary, getPromptIndex, getPromptsForStage } = await import('../lib/harness/prompt-library');
  const _planPromptLib = loadPromptLibrary(projectDir);
  const _planningIndex = getPromptIndex(_planPromptLib, 'planning');
  if (_planningIndex) {
    effectiveWorkspaceContext += _planningIndex;
    emit({ type: 'log', level: 'info', message: `Prompt library: ${_planPromptLib.filter(p => p.stage === 'planning' || p.stage === 'all').length} planning prompt(s) indexed` });
  }

  // ─── Skills injection (K5) ──────────────────────────────
  const { loadSkillIndex, activateSkills, getSkillPromptsForStage } = await import('../lib/harness/skills-loader');
  const _skillIndex = loadSkillIndex(projectDir);
  const _activeSkills = activateSkills(_skillIndex, {
    projectType: projectConfig?.type,
    taskCategory: undefined,  // not yet known at planning time
    files: undefined,
  }, projectDir);
  const _skillPlanning = getSkillPromptsForStage(_activeSkills, 'planning');
  if (_skillPlanning) {
    effectiveWorkspaceContext += _skillPlanning;
  }
  if (_skillIndex.length > 0) {
    emit({ type: 'log', level: 'info', message: `[Skills] ${_skillIndex.length} indexed, ${_activeSkills.filter(s => s._loaded).length} activated` });
  }

  if (planMode === 'debate') {
    // Debate mode: Drafter → Challenger → QC
    const { DebatePlanner } = await import('../agents/planning/debate-planner');
    const drafterMode = (taskConfig.debateDrafterMode ?? 'claude-cli') as PlanningMode;
    const debatePlanner = new DebatePlanner(drafterMode);
    const debateOutput = await debatePlanner.invoke({
      prompt: task.prompt,
      context: {
        projectDir,
        projectConfig,
        workspaceContext: effectiveWorkspaceContext,
      },
      config: {
        systemPrompt: systemPrompt ?? undefined,
      },
      onProgress: emit,
    });

    const debateResult = debateOutput.result as {
      plan: Plan;
      totalRounds: number;
      inputTokens: number;
      outputTokens: number;
    };
    planResult = {
      plan: debateResult.plan,
      costUsd: debateOutput.costUsd,
      inputTokens: debateResult.inputTokens,
      outputTokens: debateResult.outputTokens,
    };

    emit({ type: 'log', level: 'info',
      message: `[Debate] ${debateResult.totalRounds} round(s), cost: $${debateOutput.costUsd.toFixed(4)}` });
  } else {
    const planOpts = taskConfig.codingPrompt ? {
      codingPrompt: taskConfig.codingPrompt,
      verificationChecklist: taskConfig.verificationChecklist ?? '',
    } : undefined;
    const logFn = (msg: string) => emit({ type: 'log', level: 'info', message: msg });

    try {
      planResult = await generatePlan(
        task.prompt, projectConfig, planMode, planOpts, logFn,
        effectiveWorkspaceContext, projectDir, systemPrompt, undefined, taskConfig.locale,
      );
    } catch (planErr) {
      const errMsg = String(planErr);
      // Credit exhaustion fallback: claude-cli → gemini-cli
      if (
        (planMode === 'claude-cli' || planMode === 'auto') &&
        /credit balance is too low|insufficient_quota|rate_limit|billing/i.test(errMsg)
      ) {
        emit({ type: 'log', level: 'warn', message: `[Planning] ${planMode} credit exhausted, falling back to gemini-cli` });
        planResult = await generatePlan(
          task.prompt, projectConfig, 'gemini-cli' as PlanningMode, planOpts, logFn,
          effectiveWorkspaceContext, projectDir, systemPrompt, undefined, taskConfig.locale,
        );
      } else {
        throw planErr;
      }
    }
  }
  const plan = planResult.plan;

  emit({ type: 'log', level: 'info', message: `Plan: ${plan.summary}` });
  emit({ type: 'log', level: 'info', message: `Estimated files: ${plan.estimatedFiles.join(', ')}` });
  emit({ type: 'log', level: 'info', message: `Coding prompt: ${plan.codingPrompt.slice(0, 500)}` });
  emit({ type: 'log', level: 'info', message: `Verification: ${plan.verificationSpec.steps.map(s => `${s.id}:${s.type}(${s.description})`).join(', ')}` });

  // Normalize verification filePaths — convert absolute paths to relative
  if (plan.verificationSpec?.steps) {
    for (const step of plan.verificationSpec.steps) {
      if (step.filePath && isAbsolute(step.filePath)) {
        if (step.filePath.startsWith(projectDir)) {
          step.filePath = step.filePath.slice(projectDir.length).replace(/^\//, '');
        } else {
          step.filePath = step.filePath.split('/').pop() ?? step.filePath;
        }
        emit({ type: 'log', level: 'info', message: `Normalized filePath: ${step.filePath}` });
      }
    }
  }

  // ─── PostPlan hook ────────────────────────────────────
  {
    const postPlanHooks = await hookEngine.execute(
      { event: 'PostPlan', taskId, projectDir, plan: { summary: plan.summary, estimatedFiles: plan.estimatedFiles }, costUsd: planResult.costUsd },
      emit,
    );
    if (postPlanHooks.finalDecision === 'deny') {
      emit({ type: 'log', level: 'warn', message: `[Hook] PostPlan denied: ${postPlanHooks.outputs.find(o => o.decision === 'deny')?.reason ?? ''}` });
    }
    if (postPlanHooks.finalDecision === 'modify' && postPlanHooks.updatedInput?.plan) {
      const hp = postPlanHooks.updatedInput.plan as Record<string, unknown>;
      if (typeof hp.summary === 'string') plan.summary = hp.summary;
      if (typeof hp.codingPrompt === 'string') plan.codingPrompt = hp.codingPrompt;
      if (Array.isArray(hp.estimatedFiles)) plan.estimatedFiles = hp.estimatedFiles as string[];
      emit({ type: 'log', level: 'info', message: '[Hook] Plan modified by PostPlan hook' });
    }
    if (postPlanHooks.mergedContext) {
      hookContextAccumulator += (hookContextAccumulator ? '\n' : '') + postPlanHooks.mergedContext;
    }
  }

  return { planResult, hookContextAccumulator };
}

/**
 * Execute re-planning with Verify Agent feedback.
 * Extracted from runSingleCycle lines 724-835 (the re-plan block inside the outer loop).
 * Note: DB inserts for replan cost tracking are handled by the caller in pipeline.ts.
 */
export async function executeReplan(params: {
  taskId: string;
  projectDir: string;
  projectConfig: ProjectConfig | null;
  workspaceContext: string;
  systemPrompt: string | null;
  task: any;
  replanFeedback: { issues: string[]; suggestions: string[]; previousSummary: string };
  hookEngine: HookEngine;
  hookContextAccumulator: string;
  emit: EmitFn;
}): Promise<PlanResult & { hookContextAccumulator: string }> {
  const { taskId, projectDir, projectConfig, workspaceContext, systemPrompt, task, replanFeedback, hookEngine, emit } = params;
  let hookContextAccumulator = params.hookContextAccumulator;

  // ─── OnReplan hook ──────────────────────────────────
  {
    const onReplanHooks = await hookEngine.execute(
      { event: 'OnReplan', taskId, projectDir, replanCount: 0 /* caller tracks actual count */, previousIssues: replanFeedback.issues },
      emit,
    );
    if (onReplanHooks.mergedContext) {
      hookContextAccumulator += (hookContextAccumulator ? '\n' : '') + onReplanHooks.mergedContext;
    }
  }

  const replanPrompt = `${task.prompt}

## IMPORTANT: Previous attempt FAILED. You must create a DIFFERENT plan.

Previous plan summary: ${replanFeedback.previousSummary}

Issues found by verification:
${replanFeedback.issues.map((issue: string, i: number) => `${i + 1}. ${issue}`).join('\n')}

Suggestions:
${replanFeedback.suggestions.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}

DO NOT repeat the same approach. Fix the root cause of the issues above.
Consider a simpler or fundamentally different implementation strategy.`;

  const replanResult = await generatePlan(
    replanPrompt,
    projectConfig,
    // debate mode는 re-plan에서 지원 안 됨 → claude-cli로 fallback
    ((task.planningMode === 'debate' ? 'claude-cli' : task.planningMode) ?? 'claude-cli') as PlanningMode,
    undefined,
    (msg: string) => emit({ type: 'log', level: 'info', message: msg }),
    workspaceContext,
    projectDir,
    systemPrompt,
  );

  // Normalize verification filePaths for new plan
  if (replanResult.plan.verificationSpec?.steps) {
    for (const step of replanResult.plan.verificationSpec.steps) {
      if (step.filePath && isAbsolute(step.filePath)) {
        if (step.filePath.startsWith(projectDir)) {
          step.filePath = step.filePath.slice(projectDir.length).replace(/^\//, '');
        } else {
          step.filePath = step.filePath.split('/').pop() ?? step.filePath;
        }
      }
    }
  }

  return { ...replanResult, hookContextAccumulator };
}
