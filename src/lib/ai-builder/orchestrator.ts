import type {
  AIBuilderRequest,
  AIBuilderResult,
  AIBuilderStep,
  AssembledContext,
  IntentClassification,
} from './types';
import { AIBuilderError } from './types';
import { classifyIntent } from './intent/classifier';
import { assembleSystemPrompt } from './context/assembler';

/**
 * Stage 7 G6 G19-1 / G19-2 / G19-3c — AI Builder orchestrator.
 *
 * Defines the 6-step pipeline contract that subsequent PRs (G20-1 through
 * G20-3) progressively wire up. G19-3c populates assembleContext with the
 * full 5-section system prompt; callLlm is still a placeholder so run()
 * short-circuits with a partial result + warnings.
 */

const SYSTEM_PROMPT_SOFT_BUDGET = 12000;

export class AIBuilderOrchestrator {
  async run(req: AIBuilderRequest): Promise<AIBuilderResult> {
    const steps: AIBuilderStep[] = [];
    const warnings: string[] = [];

    const classification = await classifyIntent(req);
    steps.push('classify_intent');
    if (classification.fallbackUsed) {
      warnings.push('intent classification fallback used');
    }
    const intent = classification.intent;

    let context: AssembledContext;
    try {
      context = this.assembleContext(req, classification);
      steps.push('assemble_context');
    } catch (err) {
      return {
        intent,
        needsClarification: false,
        explanation: 'AI Builder failed to assemble system prompt context',
        warnings: [...warnings, `assemble_context failed: ${(err as Error).message}`],
        attempts: 0,
        steps,
      };
    }

    if (context.estimatedSystemTokens > SYSTEM_PROMPT_SOFT_BUDGET) {
      warnings.push(
        `system prompt exceeds soft budget: ${context.estimatedSystemTokens} tokens (> ${SYSTEM_PROMPT_SOFT_BUDGET})`,
      );
    }

    try {
      const raw = await this.callLlm(context);
      steps.push('call_llm');
      // Below is unreachable until G20-1 wires the SDK call.
      const parsed = this.parseResponse(raw);
      steps.push('parse_response');
      this.validate(parsed);
      steps.push('validate');
      this.computeDiff(parsed, req);
      steps.push('compute_diff');
    } catch (err) {
      if (err instanceof AIBuilderError && err.step === 'call_llm') {
        return {
          intent,
          needsClarification: false,
          explanation: 'Orchestrator skeleton — LLM not yet wired',
          warnings: [...warnings, 'G19-1 skeleton: LLM call not implemented'],
          attempts: 0,
          steps,
        };
      }
      throw err;
    }

    return {
      intent,
      needsClarification: false,
      explanation: 'Pipeline executed (placeholder)',
      warnings,
      attempts: 1,
      steps,
    };
  }

  private assembleContext(req: AIBuilderRequest, classification: IntentClassification): AssembledContext {
    return assembleSystemPrompt(req, classification);
  }

  private async callLlm(_context: AssembledContext): Promise<string> {
    throw new AIBuilderError('LLM not yet wired', 'call_llm');
  }

  private parseResponse(_raw: string): unknown {
    throw new AIBuilderError('parseResponse not implemented', 'parse_response');
  }

  private validate(_parsed: unknown): void {
    throw new AIBuilderError('validate not implemented', 'validate');
  }

  private computeDiff(_parsed: unknown, _req: AIBuilderRequest): void {
    throw new AIBuilderError('computeDiff not implemented', 'compute_diff');
  }
}
