import { z } from 'zod';

export type Intent = 'new' | 'modify' | 'clarify' | 'explain';

export type AIBuilderStep =
  | 'classify_intent'
  | 'assemble_context'
  | 'call_llm'
  | 'parse_response'
  | 'validate'
  | 'compute_diff';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIBuilderRequest {
  userMessage: string;
  currentYaml?: string;
  projectId: string;
  conversationHistory?: ConversationTurn[];
}

export interface ClarificationQuestion {
  question: string;
  options?: string[];
  isRequired: boolean;
}

export interface AIBuilderDiff {
  addedNodes: string[];
  removedNodes: string[];
  modifiedNodes: string[];
}

export interface AIBuilderResult {
  intent: Intent;
  needsClarification: boolean;
  clarificationQuestions?: ClarificationQuestion[];
  generatedYaml?: string;
  diff?: AIBuilderDiff;
  explanation: string;
  warnings: string[];
  suggestedNextSteps?: string[];
  attempts: number;
  steps: AIBuilderStep[];
  /** classifier cost + generator cost (USD). Absent on early-exit paths. */
  totalCostUsd?: number;
  /** Generator input token count (debug). */
  inputTokens?: number;
  /** Generator output token count (debug). */
  outputTokens?: number;
  /** Which execution mode was used for LLM calls. */
  mode?: 'cli' | 'sdk' | 'mixed';
}

/** LLM response shape for the intent classifier. The classifier wraps this with
 *  cost-tracking + fallback metadata before returning to the orchestrator. */
export const IntentClassificationSchema = z.object({
  intent: z.enum(['new', 'modify', 'clarify', 'explain']),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export interface IntentClassification {
  intent: Intent;
  confidence: number;
  reason: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  fallbackUsed: boolean;
}

export class AIBuilderError extends Error {
  readonly step: AIBuilderStep;
  readonly cause?: unknown;
  constructor(message: string, step: AIBuilderStep, cause?: unknown) {
    super(message);
    this.name = 'AIBuilderError';
    this.step = step;
    this.cause = cause;
  }
}

/**
 * Stage 7 G6 G20-2 — Full strict schema for the generator LLM response.
 * .passthrough() removed; all expected fields are declared explicitly.
 */
export const GeneratorResponseSchema = z.object({
  intent_recognized: z.enum(['new', 'modify', 'clarify', 'explain']),
  needs_clarification: z.boolean(),
  generated_yaml: z.string().optional(),
  explanation: z.string(),
  warnings: z.array(z.string()).default([]),
  clarification_questions: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()).optional(),
        is_required: z.boolean(),
      }),
    )
    .optional(),
  suggested_next_steps: z.array(z.string()).optional(),
  diff: z
    .object({
      added_nodes: z.array(z.string()),
      removed_nodes: z.array(z.string()),
      modified_nodes: z.array(z.string()),
    })
    .optional(),
});

export type GeneratorResponse = z.infer<typeof GeneratorResponseSchema>;

/** Output of `assembleSystemPrompt` — fed to the LLM call step (G20-1+). */
export interface AssembledContext {
  systemPrompt: string;
  userMessage: string;
  conversationHistory: ConversationTurn[];
  /** Fragment names matched by the keyword detector (debug + warning surface). */
  fragmentsUsed: string[];
  /** Char-based estimate of the system prompt only. Used for budget warnings. */
  estimatedSystemTokens: number;
}
