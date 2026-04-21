import type { AgentInput, AgentOutput } from '@/agents/interfaces';
import type { ExecutionContext, ExecutionOptions } from '../../types';

export type AgentRole = 'planner' | 'coder';
export type AgentModel = 'autodev-internal' | 'claude-code' | 'gemini-cli' | 'codex-cli';

export interface AgentBackend {
  readonly id: AgentModel;
  run(role: AgentRole, input: AgentInput, ctx: ExecutionContext, options: ExecutionOptions): Promise<AgentOutput>;
}
