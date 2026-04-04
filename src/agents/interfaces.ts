import type { PipelineEvent } from '../lib/types';

// ─── Agent Roles ──────────────────────────────────────────────
export type AgentRole = 'planning' | 'coding' | 'verify' | 'interview' | 'review' | 'evaluate';

// ─── Common Agent Interface ───────────────────────────────────
export interface IAgent {
  readonly id: string;
  readonly name: string;
  readonly role: AgentRole;

  isAvailable(): Promise<boolean>;
  invoke(input: AgentInput): Promise<AgentOutput>;
}

export interface AgentInput {
  prompt: string;
  context: {
    projectDir: string;
    projectType?: string;
    files?: string[];
    gitStatus?: string;
    previousResults?: unknown;
    verifyFeedback?: VerifyFeedback;
    // Planning-specific
    projectConfig?: unknown;
    workspaceContext?: string;
    // Coding-specific
    mcpServers?: unknown[];
  };
  config: {
    systemPrompt?: string;
    maxBudgetUsd?: number;
    timeoutMs?: number;
  };
  onProgress?: (event: PipelineEvent) => void;
}

export interface AgentOutput {
  success: boolean;
  result: unknown;
  costUsd: number;
  tokenUsage: { input: number; output: number };
  durationMs: number;
  rawOutput?: string;
}

// ─── Verify Agent Specific ────────────────────────────────────
export interface VerifyInput extends AgentInput {
  originalPrompt: string;
  modifiedFiles: string[];
  projectDir: string;
  tools: VerifyTool[];
  skipMechanical?: boolean;
}

export interface VerifyResult {
  passed: boolean;
  score: number;
  reason: string;
  issues: string[];
  suggestions: string[];
  verdict: 'pass' | 're-code' | 're-plan' | 'fail';
  evidence: {
    screenshots?: string[];
    buildResult?: string;
    consoleErrors?: string[];
    executionOutput?: string;
    codeReview?: string;
  };
}

export interface VerifyOutput extends AgentOutput {
  result: VerifyResult;
}

export interface VerifyFeedback {
  previousVerdict: string;
  issues: string[];
  suggestions: string[];
  attemptCount: number;
}

// ─── Verify Tools ─────────────────────────────────────────────
export interface VerifyTool {
  name: string;
  description: string;
  execute(params: Record<string, unknown>): Promise<VerifyToolResult>;
}

export interface VerifyToolResult {
  success: boolean;
  output: string;
  data?: unknown;
}
