import type { AgentInput, AgentOutput } from '@/agents/interfaces';
import type { ExecutionContext, ExecutionOptions } from '../../types';
import type { AgentBackend, AgentRole } from './types';
import { PlanningAgent } from '@/agents/planning/planning-agent';
import { CodingAgentWrapper } from '@/agents/coding/coding-agent';
import { GeminiCliAgent } from '@/lib/plugins/agents/gemini-cli';

export class GeminiCLIBackend implements AgentBackend {
  readonly id = 'gemini-cli' as const;

  async run(
    role: AgentRole,
    input: AgentInput,
    _ctx: ExecutionContext,
    _options: ExecutionOptions,
  ): Promise<AgentOutput> {
    if (role === 'planner') {
      return new PlanningAgent('gemini-cli').invoke(input);
    }
    return new CodingAgentWrapper(new GeminiCliAgent()).invoke(input);
  }
}
