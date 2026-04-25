import { extractJson } from '@/lib/utils/json-extractor';
import { loadPrompt } from '@/lib/harness/prompt-loader';
import {
  IntentClassificationSchema,
  type AIBuilderRequest,
  type IntentClassification,
  type Intent,
} from '../types';

/**
 * Stage 7 G6 G19-2 — first real LLM call in the AI Builder pipeline.
 *
 * Mirrors the SDK call shape from `src/worker/planning.ts:561-602` so the
 * pattern stays consistent across the codebase. Any failure (SDK throw,
 * parse error, schema mismatch) drops to a heuristic fallback instead of
 * propagating — the orchestrator surfaces this via `fallbackUsed`.
 */

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;
const TEMPERATURE = 0.1;
const SYSTEM_TAIL = 'Respond with ONLY the JSON object, no markdown code fences, no explanation.';

// Sonnet 4 published rates (USD per 1M tokens) — kept in sync with planning.ts.
const INPUT_RATE_PER_M = 3.0;
const OUTPUT_RATE_PER_M = 15.0;

export function computeCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_RATE_PER_M + (outputTokens / 1_000_000) * OUTPUT_RATE_PER_M;
}

function heuristicFallback(req: AIBuilderRequest, reason: string): IntentClassification {
  const intent: Intent = req.currentYaml ? 'modify' : 'new';
  return {
    intent,
    confidence: 0.5,
    reason,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    fallbackUsed: true,
  };
}

export async function classifyIntent(req: AIBuilderRequest): Promise<IntentClassification> {
  const prompt = loadPrompt('ai-builder-classifier', undefined, {
    userMessage: req.userMessage,
    hasCurrentYaml: req.currentYaml ? 'true' : 'false',
  });

  let response: { content: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic();
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: SYSTEM_TAIL,
      messages: [{ role: 'user', content: prompt.content }],
    });
  } catch (err) {
    return heuristicFallback(req, `fallback: SDK call failed (${(err as Error).message})`);
  }

  const text = response.content[0]?.type === 'text' ? response.content[0].text ?? '' : '';
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;

  let parsed: unknown;
  try {
    parsed = extractJson(text, 'intent');
  } catch (err) {
    return heuristicFallback(req, `fallback: parse failed (${(err as Error).message})`);
  }

  const validated = IntentClassificationSchema.safeParse(parsed);
  if (!validated.success) {
    return heuristicFallback(req, `fallback: validation failed (${validated.error.issues[0]?.message})`);
  }

  return {
    intent: validated.data.intent,
    confidence: validated.data.confidence,
    reason: validated.data.reason,
    costUsd: computeCost(inputTokens, outputTokens),
    inputTokens,
    outputTokens,
    fallbackUsed: false,
  };
}
