import type {
  AIBuilderRequest,
  AIBuilderResult,
  AIBuilderStep,
  AssembledContext,
  IntentClassification,
  Intent,
  GeneratorResponse,
} from './types';
import { AIBuilderError, GeneratorResponseSchema } from './types';
import { classifyIntent, computeCost } from './intent/classifier';
import { assembleSystemPrompt } from './context/assembler';
import { extractJson } from '@/lib/utils/json-extractor';

/**
 * Stage 7 G6 G20-1 — wire generator LLM call and parse response skeleton.
 *
 * callLlm: mirrors the SDK call shape from `src/worker/planning.ts:561-602`.
 * parseResponse: extractJson + GeneratorResponseSchema (4-field minimal Zod).
 * buildErrorResult: unified error handler for call_llm / parse_response steps.
 *
 * G20-2 extends parseResponse with full schema + validate-retry.
 * G20-3 adds computeDiff.
 */

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 8192;
const TEMPERATURE = 0.3;
const SYSTEM_PROMPT_SOFT_BUDGET = 12000;
const SDK_TIMEOUT_MS = 120_000;

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

    let llmResult: { raw: string; costUsd: number; inputTokens: number; outputTokens: number };
    try {
      llmResult = await this.callLlm(context);
      steps.push('call_llm');
    } catch (err) {
      return this.buildErrorResult(intent, steps, warnings, 'call_llm', err, classification.costUsd);
    }

    let parsed: GeneratorResponse;
    try {
      parsed = this.parseResponse(llmResult.raw);
      steps.push('parse_response');
    } catch (err) {
      return this.buildErrorResult(
        intent,
        steps,
        warnings,
        'parse_response',
        err,
        classification.costUsd + llmResult.costUsd,
      );
    }

    return {
      intent: parsed.intent_recognized,
      needsClarification: parsed.needs_clarification,
      generatedYaml: parsed.generated_yaml,
      explanation: parsed.explanation,
      warnings,
      attempts: 1,
      steps,
      totalCostUsd: classification.costUsd + llmResult.costUsd,
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
    };
  }

  private assembleContext(req: AIBuilderRequest, classification: IntentClassification): AssembledContext {
    return assembleSystemPrompt(req, classification);
  }

  private async callLlm(
    context: AssembledContext,
  ): Promise<{ raw: string; costUsd: number; inputTokens: number; outputTokens: number }> {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ timeout: SDK_TIMEOUT_MS });

    const messages = [
      ...context.conversationHistory.map((t) => ({ role: t.role as 'user' | 'assistant', content: t.content })),
      { role: 'user' as const, content: context.userMessage },
    ];

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: context.systemPrompt,
      messages,
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text ?? '' : '';
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;

    return { raw, costUsd: computeCost(inputTokens, outputTokens), inputTokens, outputTokens };
  }

  private parseResponse(raw: string): GeneratorResponse {
    let obj: unknown;
    try {
      obj = extractJson(raw, 'intent_recognized');
    } catch (err) {
      throw new AIBuilderError(
        `parse_response failed: ${(err as Error).message}`,
        'parse_response',
        err,
      );
    }

    const validated = GeneratorResponseSchema.safeParse(obj);
    if (!validated.success) {
      throw new AIBuilderError(`parse_response failed: ${validated.error.message}`, 'parse_response');
    }

    return validated.data;
  }

  private buildErrorResult(
    intent: Intent,
    steps: AIBuilderStep[],
    priorWarnings: string[],
    failedStep: AIBuilderStep,
    err: unknown,
    totalCostUsd = 0,
  ): AIBuilderResult {
    const message = err instanceof Error ? err.message : String(err);
    return {
      intent,
      needsClarification: false,
      explanation: 'AI Builder encountered an error. Please retry.',
      warnings: [...priorWarnings, `${failedStep} failed: ${message}`],
      attempts: 1,
      steps: [...steps],
      totalCostUsd,
    };
  }

  // Placeholders — wired in G20-2 (validate) and G20-3 (computeDiff).
  private validate(_parsed: unknown): void {
    throw new AIBuilderError('validate not implemented', 'validate');
  }

  private computeDiff(_parsed: unknown, _req: AIBuilderRequest): void {
    throw new AIBuilderError('computeDiff not implemented', 'compute_diff');
  }
}
