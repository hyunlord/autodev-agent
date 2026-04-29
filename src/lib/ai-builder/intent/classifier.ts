import { extractJson } from '@/lib/utils/json-extractor';
import { loadPrompt } from '@/lib/harness/prompt-loader';
import { resolveCli } from '@/lib/cli-resolver';
import { getExeca } from '@/lib/execa';
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
 *
 * CLI mode: uses Claude CLI when available (no API key needed).
 * SDK mode: falls back to @anthropic-ai/sdk when CLI not found or fails.
 */

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;
const TEMPERATURE = 0.1;
const CLI_TIMEOUT_MS = 60_000;
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

async function classifyViaSdk(promptContent: string): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: SYSTEM_TAIL,
    messages: [{ role: 'user', content: promptContent }],
  });
  return {
    text: response.content[0]?.type === 'text' ? response.content[0].text ?? '' : '',
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}

// CLI 우선, 실패 시 SDK 로 fallback. 모두 실패 시 throw.
async function getLlmOutput(
  claudePath: string | null,
  promptContent: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  if (claudePath) {
    try {
      const fullPrompt = `${SYSTEM_TAIL}\n\n${promptContent}`;
      const execa = await getExeca();
      const { ANTHROPIC_API_KEY: _key, ...envWithoutKey } = process.env;
      const result = await execa(claudePath, [
        '--output-format', 'text',
        '--max-turns', '3',
      ], {
        timeout: CLI_TIMEOUT_MS,
        reject: false,
        input: fullPrompt,
        env: envWithoutKey,
      });
      if (result.exitCode !== 0) throw new Error(`CLI exited ${result.exitCode}`);
      const text = result.stdout;
      return {
        text,
        inputTokens: Math.ceil(fullPrompt.length / 4),
        outputTokens: Math.ceil(text.length / 4),
      };
    } catch {
      // CLI failed → fall through to SDK
    }
  }
  return classifyViaSdk(promptContent);
}

export async function classifyIntent(req: AIBuilderRequest): Promise<IntentClassification> {
  const prompt = loadPrompt('ai-builder-classifier', undefined, {
    userMessage: req.userMessage,
    hasCurrentYaml: req.currentYaml ? 'true' : 'false',
  });

  let text: string;
  let inputTokens: number;
  let outputTokens: number;

  try {
    const claudePath = await resolveCli('claude');
    ({ text, inputTokens, outputTokens } = await getLlmOutput(claudePath, prompt.content));
  } catch (err) {
    return heuristicFallback(req, `fallback: SDK call failed (${(err as Error).message})`);
  }

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
