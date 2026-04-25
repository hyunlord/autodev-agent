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
