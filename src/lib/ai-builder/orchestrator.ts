import type {
  AIBuilderRequest,
  AIBuilderResult,
  AIBuilderStep,
  Intent,
} from './types';
import { AIBuilderError } from './types';

/**
 * Stage 7 G6 G19-1 — AI Builder orchestrator skeleton.
 *
 * Defines the 6-step pipeline contract that subsequent PRs (G19-2 through
 * G20-3) progressively wire up. This PR keeps every step as a placeholder:
 * `classifyIntent` uses a one-line heuristic; `callLlm` throws to short-
 * circuit the pipeline before any real LLM dependency lands. The shape of
 * `AIBuilderResult` is the contract callers depend on.
 */

interface AssembledContext {
  // G19-3 will populate: compressed ADPL spec, few-shot examples,
  // conversation history, current yaml excerpt, project metadata.
}

export class AIBuilderOrchestrator {
  async run(req: AIBuilderRequest): Promise<AIBuilderResult> {
    const steps: AIBuilderStep[] = [];

    const intent = this.classifyIntent(req);
    steps.push('classify_intent');

    const context = this.assembleContext(req, intent);
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
          warnings: ['G19-1 skeleton: LLM call not implemented'],
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
      warnings: [],
      attempts: 1,
      steps,
    };
  }

  private classifyIntent(req: AIBuilderRequest): Intent {
    // G19-2 will replace with a real LLM-backed classifier.
    return req.currentYaml ? 'modify' : 'new';
  }

  private assembleContext(_req: AIBuilderRequest, _intent: Intent): AssembledContext {
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
