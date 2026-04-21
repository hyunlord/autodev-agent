import type { AgentInput, AgentOutput } from '@/agents/interfaces';
import type { ExecutionContext, ExecutionOptions } from '../../types';

export type AgentRole = 'planner' | 'coder' | 'verifier';
export type AgentModel =
  | 'autodev-internal'
  | 'claude-code'
  | 'gemini-cli'
  | 'codex-cli'
  | 'auto-cross-model'
  | 'claude-cli';

export interface AgentBackend {
  readonly id: AgentModel;
  run(role: AgentRole, input: AgentInput, ctx: ExecutionContext, options: ExecutionOptions): Promise<AgentOutput>;
}
