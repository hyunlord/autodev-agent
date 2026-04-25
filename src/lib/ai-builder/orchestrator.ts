import type {
  AIBuilderRequest,
  AIBuilderResult,
  AIBuilderStep,
} from './types';
import { AIBuilderError } from './types';
import { classifyIntent } from './intent/classifier';

/**
 * Stage 7 G6 G19-1 / G19-2 — AI Builder orchestrator.
 *
 * Defines the 6-step pipeline contract that subsequent PRs (G19-3 through
 * G20-3) progressively wire up. G19-2 wires the first real LLM call:
 * `classifyIntent` (with heuristic fallback). The remaining steps still
 * short-circuit at `callLlm` so the run() shape stays observable.
 */

interface AssembledContext {
  // G19-3 will populate: compressed ADPL spec, few-shot examples,
  // conversation history, current yaml excerpt, project metadata.
}

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

    const context = this.assembleContext(req);
    steps.push('assemble_context');

    try {
      const raw = await this.callLlm(context);
      steps.push('call_llm');
      // Below is unreachable until G20-1 wires the SDK call. Kept here so
      // the contract of the pipeline (shape + ordering) is committed.
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

  private assembleContext(_req: AIBuilderRequest): AssembledContext {
    return {};
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
