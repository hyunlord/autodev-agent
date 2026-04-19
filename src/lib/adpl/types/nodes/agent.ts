import type { NodeSpecBase, RetryPolicy } from '../common';

export type AgentRole = 'planner' | 'coder' | 'verifier' | 'reviewer' | 'custom';

// agent.output 설정
export interface OutputSpec {
  schema?: Record<string, unknown>; // Zod-compatible JSON Schema
  parseAs?: 'auto' | 'json' | 'text'; // default: auto
  strict?: boolean; // true이면 schema 불일치 시 ERR_QUALITY
}

// fallback 모델 설정
export interface FallbackSpec {
  model: string;
  onErrors?: string[]; // 이 에러 코드에서만 폴백 (default: 모든 에러)
  maxAttempts?: number; // default: 1
}

export type ToolPolicySpec = Record<string, unknown>;

export interface AgentNodeSpec extends NodeSpecBase {
  type: 'agent';
  // default: 'planner'. role: 'custom' 이면 prompt + model 필수
  role?: AgentRole;
  model?: string; // 'claude-code' | 'gemini-cli' | 'codex-cli' | 'api:...'
  prompt?: string; // Slot 1 표현식 가능. custom role 이면 필수
  systemPrompt?: string; // role 없는 경우 권장
  inputs?: Record<string, string>; // { key: Slot1Expression }
  output?: OutputSpec;
  useMemory?: boolean; // default: false
  maxTokens?: number;
  temperature?: number; // 0-2
  costLimit?: number; // USD
  fallback?: FallbackSpec;
  toolPolicy?: ToolPolicySpec;
}
