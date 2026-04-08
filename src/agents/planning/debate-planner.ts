import type { IAgent, AgentInput, AgentOutput } from '../interfaces';
import type { PipelineEvent } from '../../lib/types';
import type { PlanningMode } from '../../lib/types';
import { generatePlan, type Plan, type PlanResult } from '../../worker/planning';
import type { ProjectConfig } from '../../lib/detection/project-type';
import { resolveCli } from '../../lib/cli-resolver';
import { getExeca } from '../../lib/execa';
import { extractJson } from '../../lib/utils/json-extractor';

interface DebateRound {
  draft: string;
  challenge: string;
  revision: string;
  qcVerdict: 'approved' | 'revise' | 'fail';
  qcFeedback: string;
}

export interface DebatePlanningOutput extends AgentOutput {
  result: {
    plan: Plan;
    rounds: DebateRound[];
    totalRounds: number;
    inputTokens: number;
    outputTokens: number;
  };
}

const MAX_DEBATE_ROUNDS = 2;

export class DebatePlanner implements IAgent {
  readonly id = 'planning-debate';
  readonly name = 'Planning Agent (Debate Mode)';
  readonly role = 'planning' as const;
  private cliMode: PlanningMode;

  constructor(cliMode?: PlanningMode) {
    this.cliMode = cliMode ?? 'claude-cli';
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async invoke(input: AgentInput): Promise<DebatePlanningOutput> {
    const startTime = Date.now();
    const emit = input.onProgress ?? (() => {});
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const rounds: DebateRound[] = [];

    const projectConfig = input.context.projectConfig as ProjectConfig | null;
    const workspaceContext = input.context.workspaceContext ?? '';

    emit({ type: 'log', level: 'info', message: '[Debate] Starting debate mode planning...' } as PipelineEvent);

    // ─── Step 1a: Drafter — plan 초안 ─────────────────────
    emit({ type: 'log', level: 'info', message: '[Debate] Step 1a: Drafter generating plan draft...' } as PipelineEvent);
    emit({ type: 'log', level: 'info', message: `[Debate Step 1a] prompt length: ${input.prompt.length} chars, mode: ${this.cliMode}` } as PipelineEvent);

    const draftResult: PlanResult = await generatePlan(
      input.prompt,
      projectConfig,
      this.cliMode,
      undefined,
      (msg) => emit({ type: 'log', level: 'info', message: `[Drafter] ${msg}` } as PipelineEvent),
      workspaceContext,
      input.context.projectDir,
      input.config.systemPrompt ?? null,
    );

    totalCost += draftResult.costUsd;
    totalInputTokens += draftResult.inputTokens;
    totalOutputTokens += draftResult.outputTokens;

    let currentPlan = draftResult.plan;
    let draftSummary = JSON.stringify(currentPlan, null, 2);

    emit({ type: 'log', level: 'info', message: `[Drafter] Draft: ${currentPlan.summary}` } as PipelineEvent);

    // ─── Debate loop (max 2 rounds) ─────────────────────
    for (let round = 1; round <= MAX_DEBATE_ROUNDS; round++) {
      emit({ type: 'log', level: 'info', message: `[Debate] Round ${round}/${MAX_DEBATE_ROUNDS}` } as PipelineEvent);

      // ─── Step 1b: Challenger — 적대적 공격 (격리: plan만 봄) ───
      emit({ type: 'log', level: 'info', message: '[Debate] Step 1b: Challenger attacking plan...' } as PipelineEvent);

      const challengeResult = await this.runChallenger(currentPlan, input.prompt, emit);
      totalCost += challengeResult.costUsd;

      if (!challengeResult.issues || challengeResult.issues.length === 0) {
        emit({ type: 'log', level: 'info', message: '[Challenger] No issues found. Plan looks solid.' } as PipelineEvent);
        rounds.push({
          draft: draftSummary,
          challenge: 'No issues found',
          revision: '',
          qcVerdict: 'approved',
          qcFeedback: 'Challenger found no issues',
        });
        break;
      }

      emit({ type: 'log', level: 'warn', message: `[Challenger] Found ${challengeResult.issues.length} issues: ${challengeResult.issues.join('; ')}` } as PipelineEvent);

      // ─── Step 1c: Drafter revision — challenge 반영 수정 ───
      emit({ type: 'log', level: 'info', message: '[Debate] Step 1c: Drafter revising plan...' } as PipelineEvent);

      const revisionPrompt = `${input.prompt}

## REVISION REQUIRED

Previous plan summary:
${currentPlan.summary}

Previous coding prompt (truncated):
${currentPlan.codingPrompt.slice(0, 3000)}

A challenger agent found these issues:
${challengeResult.issues.map((issue: string, i: number) => `${i + 1}. ${issue}`).join('\n')}

${challengeResult.suggestions.length > 0 ? `Suggestions:\n${challengeResult.suggestions.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}` : ''}

Revise the plan to address ALL issues above.
If a challenge is invalid, explain why in the codingPrompt — don't silently ignore it.
Keep the same JSON output format.`;

      emit({ type: 'log', level: 'info', message: `[Debate Step 1c] revision prompt length: ${revisionPrompt.length} chars (~${Math.ceil(revisionPrompt.length / 4)} tokens), mode: ${this.cliMode}, timeout: 240s` } as PipelineEvent);

      const revisionResult = await generatePlan(
        revisionPrompt,
        projectConfig,
        this.cliMode,
        undefined,
        (msg) => emit({ type: 'log', level: 'info', message: `[Drafter Revision] ${msg}` } as PipelineEvent),
        workspaceContext,
        input.context.projectDir,
        input.config.systemPrompt ?? null,
        240_000,
      );

      totalCost += revisionResult.costUsd;
      totalInputTokens += revisionResult.inputTokens;
      totalOutputTokens += revisionResult.outputTokens;

      const revisedPlan = revisionResult.plan;
      emit({ type: 'log', level: 'info', message: `[Drafter Revision] Revised: ${revisedPlan.summary}` } as PipelineEvent);

      // ─── Step 1d: Quality Checker — 3개 문서 비교 ───
      emit({ type: 'log', level: 'info', message: '[Debate] Step 1d: Quality Checker reviewing...' } as PipelineEvent);

      const qcResult = await this.runQualityChecker(
        currentPlan, challengeResult.issues, revisedPlan, input.prompt, emit,
      );
      totalCost += qcResult.costUsd;

      rounds.push({
        draft: draftSummary,
        challenge: challengeResult.issues.join('; '),
        revision: revisedPlan.summary,
        qcVerdict: qcResult.verdict,
        qcFeedback: qcResult.feedback,
      });

      emit({ type: 'log', level: 'info', message: `[QC] Verdict: ${qcResult.verdict} — ${qcResult.feedback}` } as PipelineEvent);

      if (qcResult.verdict === 'approved') {
        currentPlan = revisedPlan;
        draftSummary = JSON.stringify(currentPlan, null, 2);
        break;
      }

      if (qcResult.verdict === 'fail') {
        emit({ type: 'log', level: 'error', message: '[QC] Plan fundamentally flawed. Stopping debate.' } as PipelineEvent);
        // Still use the latest revision — it's better than nothing
        currentPlan = revisedPlan;
        break;
      }

      // verdict === 'revise' → next round with revised plan as new draft
      currentPlan = revisedPlan;
      draftSummary = JSON.stringify(currentPlan, null, 2);
    }

    emit({ type: 'log', level: 'info', message: `[Debate] Completed in ${rounds.length} round(s). Final plan: ${currentPlan.summary}` } as PipelineEvent);

    return {
      success: true,
      result: {
        plan: currentPlan,
        rounds,
        totalRounds: rounds.length,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
      costUsd: totalCost,
      tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
      durationMs: Date.now() - startTime,
    };
  }

  // ─── Challenger: plan만 봄 (격리) ─────────────────────
  private async runChallenger(
    plan: Plan,
    originalPrompt: string,
    emit: (e: PipelineEvent) => void,
  ): Promise<{ issues: string[]; suggestions: string[]; costUsd: number }> {

    const challengePrompt = `You are an adversarial plan challenger. Your ONLY job is to find weaknesses, gaps, and potential failures in this plan.

=== ISOLATION NOTICE ===
You can ONLY see the plan and the original user request below.
You CANNOT see the project code, file contents, or any implementation details.
This isolation is intentional — you judge the plan purely on its logical merit.
Do NOT assume you know what the codebase looks like.
Do NOT say "the existing code probably handles this" — you don't know that.

## Original User Request
${originalPrompt}

## Plan to Challenge
Summary: ${plan.summary}

Coding instructions:
${plan.codingPrompt}

Estimated files: ${plan.estimatedFiles.join(', ')}

## Your Task
Attack this plan. Find:
1. Missing features — does the plan cover ALL requirements from the user request?
2. Logic gaps — are there conditions, edge cases, or error paths not addressed?
3. Ambiguity — are the coding instructions specific enough, or will the coder guess?
4. Feasibility — can this actually be built as described? Any unrealistic assumptions?
5. Common LLM mistakes — will the coder likely reverse win/lose conditions, forget error handling, or miss edge cases?

Be aggressive. Your value is in finding problems the drafter missed.
If the plan is genuinely solid, say so — but default to skepticism.

Respond with ONLY valid JSON:
{
  "issues": ["specific issue 1", "specific issue 2"],
  "suggestions": ["how to fix issue 1", "how to fix issue 2"],
  "severity": "minor" | "major" | "critical"
}

If no real issues: { "issues": [], "suggestions": [], "severity": "minor" }`;

    try {
      const ex = await getExeca();
      let stdout = '';
      // Use a different CLI than the drafter if possible
      const cliPath = await resolveCli('gemini') ?? await resolveCli('claude');

      if (cliPath) {
        const cliName = cliPath.includes('gemini') ? 'gemini' : 'claude';
        const args = cliName === 'claude'
          ? ['--output-format', 'text', '--max-turns', '2', '--dangerously-skip-permissions']
          : [];

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90_000);
        try {
          const result = await ex(cliPath, args, {
            cwd: '/tmp', reject: false, timeout: 90_000, cancelSignal: controller.signal,
            input: challengePrompt,
          } as any);
          stdout = (result as any).stdout ?? '';
        } finally {
          clearTimeout(timer);
        }
      }

      if (stdout) {
        const parsed = extractJson<{ issues: string[]; suggestions: string[]; severity: string }>(stdout, 'issues');
        return {
          issues: parsed.issues ?? [],
          suggestions: parsed.suggestions ?? [],
          costUsd: Math.ceil(challengePrompt.length / 4) / 1_000_000 * 3.0,
        };
      }
    } catch (err) {
      emit({ type: 'log', level: 'warn', message: `[Challenger] Failed: ${err}` } as PipelineEvent);
    }

    return { issues: [], suggestions: [], costUsd: 0 };
  }

  // ─── Quality Checker: draft + challenge + revised 비교 ───
  private async runQualityChecker(
    originalPlan: Plan,
    challengeIssues: string[],
    revisedPlan: Plan,
    originalPrompt: string,
    emit: (e: PipelineEvent) => void,
  ): Promise<{ verdict: 'approved' | 'revise' | 'fail'; feedback: string; costUsd: number }> {

    const qcPrompt = `You are a plan quality checker. You have access to THREE documents:
1. The original plan draft
2. The challenger's issues
3. The revised plan

Your job is to determine if the revised plan adequately addresses ALL challenger issues.

=== ISOLATION NOTICE ===
You can ONLY see the three documents below and the original user request.
You CANNOT see the project code, file contents, or any implementation details.
This isolation is intentional — judge the revision purely on whether it addresses the challenger's issues.

## Original User Request
${originalPrompt}

## Original Plan
Summary: ${originalPlan.summary}
Coding prompt: ${originalPlan.codingPrompt.slice(0, 8000)}

## Challenger's Issues
${challengeIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

## Revised Plan
Summary: ${revisedPlan.summary}
Coding prompt: ${revisedPlan.codingPrompt.slice(0, 8000)}

## Your Task
Compare all three. Check:
1. Did the revision address EVERY challenger issue? (addressed or reasonably rejected)
2. Did the revision introduce NEW problems?
3. Is the revised plan specific enough for a coding agent to implement without ambiguity?
4. Would this plan survive verification by an adversarial verify agent?

Respond with ONLY valid JSON:
{
  "verdict": "approved" | "revise" | "fail",
  "feedback": "Explanation of verdict",
  "unaddressedIssues": ["issue that was ignored"],
  "newProblems": ["problem introduced by revision"]
}

Verdicts:
- "approved": All issues addressed, plan is ready for coding
- "revise": Some issues not addressed, needs another revision round
- "fail": Plan is fundamentally flawed, cannot be fixed by revision`;

    try {
      const ex = await getExeca();
      let stdout = '';
      // QC should ideally use yet another CLI, but fallback is fine
      const cliPath = await resolveCli('claude') ?? await resolveCli('gemini');

      if (cliPath) {
        const cliName = cliPath.includes('gemini') ? 'gemini' : 'claude';
        const args = cliName === 'claude'
          ? ['--output-format', 'text', '--max-turns', '2', '--dangerously-skip-permissions']
          : [];

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90_000);
        try {
          const result = await ex(cliPath, args, {
            cwd: '/tmp', reject: false, timeout: 90_000, cancelSignal: controller.signal,
            input: qcPrompt,
          } as any);
          stdout = (result as any).stdout ?? '';
        } finally {
          clearTimeout(timer);
        }
      }

      if (stdout) {
        const parsed = extractJson<{ verdict: string; feedback: string }>(stdout, 'verdict');
        const verdict = parsed.verdict;
        return {
          verdict: (['approved', 'revise', 'fail'].includes(verdict) ? verdict : 'approved') as 'approved' | 'revise' | 'fail',
          feedback: parsed.feedback ?? '',
          costUsd: Math.ceil(qcPrompt.length / 4) / 1_000_000 * 3.0,
        };
      }
    } catch (err) {
      emit({ type: 'log', level: 'warn', message: `[QC] Failed: ${err}` } as PipelineEvent);
    }

    // Fallback: approve if QC fails
    return { verdict: 'approved', feedback: 'QC unavailable, auto-approved', costUsd: 0 };
  }
}
