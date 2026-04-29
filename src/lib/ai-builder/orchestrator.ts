import type {
  AIBuilderRequest,
  AIBuilderResult,
  AIBuilderStep,
  AssembledContext,
  IntentClassification,
  Intent,
  GeneratorResponse,
  AIBuilderDiff,
} from './types';
import { AIBuilderError, GeneratorResponseSchema } from './types';
import { classifyIntent, computeCost } from './intent/classifier';
import { assembleSystemPrompt } from './context/assembler';
import { extractJson } from '@/lib/utils/json-extractor';
import { PipelineCompiler } from '@/lib/adpl/engine/compiler';
import type { CompileError } from '@/lib/adpl/engine/compiler';
import { parseYaml } from '@/lib/adpl/engine/compiler/yaml-parser';
import { resolveCli } from '@/lib/cli-resolver';
import { getExeca } from '@/lib/execa';

/**
 * Stage 7 G6 G20-2 — ADPL Compiler validation + validate-retry loop.
 *
 * run(): for-loop up to MAX_ATTEMPTS (initial + 2 retries) with retry-message
 *        feedback when ADPL compiler reports errors.
 * validate(): wraps PipelineCompiler.compile() — skip if no generated_yaml.
 * callLlm(): accepts optional retryMessages appended after the user message.
 *
 * G20-3 wires computeDiff.
 */

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 8192;
const TEMPERATURE = 0.3;
const SYSTEM_PROMPT_SOFT_BUDGET = 12000;
const SDK_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const CLI_TIMEOUT_MS = 120_000;

export class AIBuilderOrchestrator {
  async run(req: AIBuilderRequest): Promise<AIBuilderResult> {
    const steps: AIBuilderStep[] = [];
    const preWarnings: string[] = [];

    // Step 1: classify intent
    const classification = await classifyIntent(req);
    steps.push('classify_intent');
    if (classification.fallbackUsed) {
      preWarnings.push('intent classification fallback used');
    }
    const intent = classification.intent;

    // Step 2: assemble context
    let context: AssembledContext;
    try {
      context = this.assembleContext(req, classification);
      steps.push('assemble_context');
    } catch (err) {
      return {
        intent,
        needsClarification: false,
        explanation: 'AI Builder failed to assemble system prompt context',
        warnings: [...preWarnings, `assemble_context failed: ${(err as Error).message}`],
        attempts: 0,
        steps,
      };
    }

    if (context.estimatedSystemTokens > SYSTEM_PROMPT_SOFT_BUDGET) {
      preWarnings.push(
        `system prompt exceeds soft budget: ${context.estimatedSystemTokens} tokens (> ${SYSTEM_PROMPT_SOFT_BUDGET})`,
      );
    }

    let totalCostUsd = classification.costUsd;
    let lastInputTokens = 0;
    let lastOutputTokens = 0;
    let lastParsed: GeneratorResponse | null = null;
    let lastValidationErrors: CompileError[] = [];
    let retryMessages: Array<{ role: 'user' | 'assistant'; content: string }> | undefined;

    // Steps 3-5: LLM call + parse + validate (with retry)
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Step 3: call LLM
      let llmResult: { raw: string; costUsd: number; inputTokens: number; outputTokens: number };
      try {
        llmResult = await this.callLlm(context, retryMessages);
      } catch (err) {
        return this.buildErrorResult(intent, steps, preWarnings, 'call_llm', err, totalCostUsd, attempt);
      }

      totalCostUsd += llmResult.costUsd;
      lastInputTokens = llmResult.inputTokens;
      lastOutputTokens = llmResult.outputTokens;

      // steps uses set-semantics: each phase recorded once; use `attempts` for retry count.
      if (!steps.includes('call_llm')) steps.push('call_llm');

      // Step 4: parse response
      let parsed: GeneratorResponse;
      try {
        parsed = this.parseResponse(llmResult.raw);
        lastParsed = parsed;
      } catch (err) {
        return this.buildErrorResult(intent, steps, preWarnings, 'parse_response', err, totalCostUsd, attempt);
      }

      if (!steps.includes('parse_response')) steps.push('parse_response');

      // Step 5: validate (ADPL Compiler)
      const validation = await this.validate(parsed);
      if (!steps.includes('validate')) steps.push('validate');
      lastValidationErrors = validation.errors;

      if (validation.ok) {
        const diff = await this.computeDiff(parsed, req);
        if (!steps.includes('compute_diff')) steps.push('compute_diff');
        return this.buildSuccessResult(
          parsed,
          classification,
          attempt,
          steps,
          preWarnings,
          validation.warnings,
          totalCostUsd,
          lastInputTokens,
          lastOutputTokens,
          diff,
        );
      }

      // Validation failed — prepare retry message for next attempt
      if (attempt < MAX_ATTEMPTS) {
        retryMessages = [
          { role: 'assistant', content: llmResult.raw },
          { role: 'user', content: this.buildRetryMessage(validation.errors) },
        ];
      }
    }

    // Max retries exhausted
    const diff = lastParsed ? await this.computeDiff(lastParsed, req) : undefined;
    if (!steps.includes('compute_diff')) steps.push('compute_diff');
    return this.buildMaxRetryResult(
      lastParsed,
      intent,
      MAX_ATTEMPTS,
      steps,
      preWarnings,
      lastValidationErrors,
      totalCostUsd,
      lastInputTokens,
      lastOutputTokens,
      diff,
    );
  }

  private assembleContext(req: AIBuilderRequest, classification: IntentClassification): AssembledContext {
    return assembleSystemPrompt(req, classification);
  }

  private async callLlm(
    context: AssembledContext,
    retryMessages?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ raw: string; costUsd: number; inputTokens: number; outputTokens: number }> {
    const claudePath = await resolveCli('claude');
    if (claudePath) {
      try {
        return await this.callLlmViaCli(claudePath, context, retryMessages);
      } catch {
        // CLI failed → fall through to SDK
      }
    }
    return this.callLlmViaSdk(context, retryMessages);
  }

  private async callLlmViaCli(
    claudePath: string,
    context: AssembledContext,
    retryMessages?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ raw: string; costUsd: number; inputTokens: number; outputTokens: number }> {
    const history = context.conversationHistory
      .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
      .join('\n\n');
    const retryText = retryMessages
      ?.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n') ?? '';
    const fullPrompt = [context.systemPrompt, history, `User: ${context.userMessage}`, retryText]
      .filter(Boolean)
      .join('\n\n');

    const execa = await getExeca();
    const { ANTHROPIC_API_KEY: _key, ...envWithoutKey } = process.env;
    const result = await execa(claudePath, [
      '--output-format', 'text',
      '--max-turns', '5',
    ], {
      timeout: CLI_TIMEOUT_MS,
      reject: false,
      input: fullPrompt,
      env: envWithoutKey,
    });

    if (result.exitCode !== 0) {
      throw new Error(`claude CLI exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`);
    }

    const raw = result.stdout;
    const estimatedInputTokens = Math.ceil(fullPrompt.length / 4);
    const estimatedOutputTokens = Math.ceil(raw.length / 4);
    return {
      raw,
      costUsd: computeCost(estimatedInputTokens, estimatedOutputTokens),
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
    };
  }

  private async callLlmViaSdk(
    context: AssembledContext,
    retryMessages?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ raw: string; costUsd: number; inputTokens: number; outputTokens: number }> {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ timeout: SDK_TIMEOUT_MS });

    const messages = [
      ...context.conversationHistory.map((t) => ({ role: t.role as 'user' | 'assistant', content: t.content })),
      { role: 'user' as const, content: context.userMessage },
      ...(retryMessages ?? []),
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

  private async validate(parsed: GeneratorResponse): Promise<{
    ok: boolean;
    errors: CompileError[];
    warnings: CompileError[];
  }> {
    if (!parsed.generated_yaml) {
      const warnings: CompileError[] = [];
      if (parsed.intent_recognized === 'new' || parsed.intent_recognized === 'modify') {
        warnings.push({
          code: 'parse_error',
          message: `intent '${parsed.intent_recognized}' expected generated_yaml but none was provided`,
        });
      }
      return { ok: true, errors: [], warnings };
    }
    const compiler = new PipelineCompiler();
    const result = await compiler.compile(parsed.generated_yaml);
    if (result.ok) {
      return { ok: true, errors: [], warnings: result.warnings };
    }
    return { ok: false, errors: result.errors, warnings: result.warnings };
  }

  private buildRetryMessage(errors: CompileError[]): string {
    const errorList = errors
      .map((e) => `- [${e.code}]${e.pathId ? ` (${e.pathId})` : ''}: ${e.message}`)
      .join('\n');
    return [
      'The previous response contains ADPL validation errors. Please fix and respond again with the same JSON format.',
      '',
      'Errors:',
      errorList,
      '',
      'Output the corrected JSON only, no preamble.',
    ].join('\n');
  }

  private buildErrorResult(
    intent: Intent,
    steps: AIBuilderStep[],
    priorWarnings: string[],
    failedStep: AIBuilderStep,
    err: unknown,
    totalCostUsd = 0,
    attempts = 1,
  ): AIBuilderResult {
    const message = err instanceof Error ? err.message : String(err);
    return {
      intent,
      needsClarification: false,
      explanation: 'AI Builder encountered an error. Please retry.',
      warnings: [...priorWarnings, `${failedStep} failed: ${message}`],
      attempts,
      steps: [...steps],
      totalCostUsd,
    };
  }

  private buildSuccessResult(
    parsed: GeneratorResponse,
    _classification: IntentClassification,
    attempts: number,
    steps: AIBuilderStep[],
    preWarnings: string[],
    compilerWarnings: CompileError[],
    totalCostUsd: number,
    inputTokens: number,
    outputTokens: number,
    diff?: AIBuilderDiff,
  ): AIBuilderResult {
    return {
      intent: parsed.intent_recognized,
      needsClarification: parsed.needs_clarification,
      clarificationQuestions: parsed.clarification_questions?.map((q) => ({
        question: q.question,
        options: q.options,
        isRequired: q.is_required,
      })),
      generatedYaml: parsed.generated_yaml,
      diff,
      explanation: parsed.explanation,
      warnings: [
        ...preWarnings,
        ...parsed.warnings,
        ...compilerWarnings.map((w) => `[${w.code}] ${w.message}`),
      ],
      suggestedNextSteps: parsed.suggested_next_steps,
      attempts,
      steps: [...steps],
      totalCostUsd,
      inputTokens,
      outputTokens,
    };
  }

  private buildMaxRetryResult(
    lastParsed: GeneratorResponse | null,
    intent: Intent,
    attempts: number,
    steps: AIBuilderStep[],
    preWarnings: string[],
    validationErrors: CompileError[],
    totalCostUsd: number,
    inputTokens: number,
    outputTokens: number,
    diff?: AIBuilderDiff,
  ): AIBuilderResult {
    const errorWarnings = validationErrors.map(
      (e) => `[${e.code}]${e.pathId ? ` (${e.pathId})` : ''}: ${e.message}`,
    );
    return {
      intent: lastParsed ? lastParsed.intent_recognized : intent,
      needsClarification: lastParsed?.needs_clarification ?? false,
      clarificationQuestions: lastParsed?.clarification_questions?.map((q) => ({
        question: q.question,
        options: q.options,
        isRequired: q.is_required,
      })),
      generatedYaml: lastParsed?.generated_yaml,
      diff,
      explanation:
        lastParsed?.explanation ??
        'Max retry attempts reached without successful validation.',
      warnings: [
        ...preWarnings,
        `Max retry attempts (${attempts}) reached. The generated YAML may contain validation errors.`,
        ...errorWarnings,
        ...(lastParsed?.warnings ?? []),
      ],
      suggestedNextSteps: lastParsed?.suggested_next_steps,
      attempts,
      steps: [...steps],
      totalCostUsd,
      inputTokens,
      outputTokens,
    };
  }

  private async computeDiff(
    parsed: GeneratorResponse,
    req: AIBuilderRequest,
  ): Promise<AIBuilderDiff | undefined> {
    if (parsed.intent_recognized !== 'modify' || !req.currentYaml || !parsed.generated_yaml) {
      return undefined;
    }
    try {
      const [oldPipeline, newPipeline] = await Promise.all([
        parseYaml({ yaml: req.currentYaml }),
        parseYaml({ yaml: parsed.generated_yaml }),
      ]);
      const oldNodes = new Map(oldPipeline.raw.pipeline.map((n) => [n.id, n]));
      const newNodes = new Map(newPipeline.raw.pipeline.map((n) => [n.id, n]));
      const addedNodes = [...newNodes.keys()].filter((id) => !oldNodes.has(id));
      const removedNodes = [...oldNodes.keys()].filter((id) => !newNodes.has(id));
      const modifiedNodes = [...newNodes.keys()].filter((id) => {
        if (!oldNodes.has(id)) return false;
        return JSON.stringify(oldNodes.get(id)) !== JSON.stringify(newNodes.get(id));
      });
      return { addedNodes, removedNodes, modifiedNodes };
    } catch {
      return undefined;
    }
  }
}
