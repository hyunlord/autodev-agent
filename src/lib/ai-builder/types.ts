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
