import type { PipelineEvent } from '../types';

// ─── MCP ──────────────────────────────────────────────────────

export interface McpServerInfo {
  id: string;
  command?: string;
  args?: string[];
  url?: string;
  type: 'local' | 'remote';
}

// ─── Coding Agent ─────────────────────────────────────────────

export interface CodingAgentOptions {
  task: string;
  projectDir: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  testCmd?: string;
  model?: string;
  mcpServers?: McpServerInfo[];
  onProgress?: (event: PipelineEvent) => void;
}

export interface CodingAgentResult {
  success: boolean;
  text: string;
  modifiedFiles: string[];
  costUsd?: number;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
  rawOutput?: unknown;
}

export interface ICodingAgent {
  readonly id: string;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  invoke(opts: CodingAgentOptions): Promise<CodingAgentResult>;
}

// ─── Verifier ─────────────────────────────────────────────────

export interface VerifyOptions {
  projectDir: string;
  projectType: string;
  buildCmd?: string;
  devCmd?: string;
  port?: number;
  steps: VerificationStep[];
  screenshotDir: string;
}

export interface VerificationStep {
  action: string;
  target?: string;
  selector?: string;
  assertions?: Array<{
    type: string;
    expected: unknown;
  }>;
}

export interface VerifyResult {
  passed: boolean;
  results: Array<{
    checkId: string;
    status: 'pass' | 'fail' | 'skip';
    expected?: string;
    actual?: string;
    screenshotPath?: string;
    error?: string;
    durationMs: number;
  }>;
  consoleErrors: string[];
}

export interface IVerifier {
  readonly id: string;
  readonly type: 'web' | 'desktop' | 'cli' | 'api' | 'file';
  verify(opts: VerifyOptions): Promise<VerifyResult>;
}

// ─── VLM Provider ─────────────────────────────────────────────

export interface VLMAnalysis {
  pass: boolean;
  confidence: number;
  reasoning: string;
}

export interface IVLMProvider {
  readonly id: string;
  readonly name: string;
  analyze(screenshot: Buffer, prompt: string): Promise<VLMAnalysis>;
}
