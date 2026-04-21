import type { AgentInput, AgentOutput } from '@/agents/interfaces';
import type { ExecutionContext, ExecutionOptions } from '../../types';
import type { AgentBackend, AgentRole } from './types';
import { PlanningAgent } from '@/agents/planning/planning-agent';
import { CodingAgentWrapper } from '@/agents/coding/coding-agent';
import { CodexCliAgent } from '@/lib/plugins/agents/codex-cli';
import { emitFallback } from '../streaming';

const MAX_PROMPT_LENGTH = 12_000;

export class CodexCLIBackend implements AgentBackend {
  readonly id = 'codex-cli' as const;

  async run(
    role: AgentRole,
    input: AgentInput,
    ctx: ExecutionContext,
    options: ExecutionOptions,
  ): Promise<AgentOutput> {
    if (input.prompt.length > MAX_PROMPT_LENGTH) {
      emitFallback(ctx, options, 'full-prompt', 'truncated-prompt', 'prompt-truncated');
    }

    if (role === 'planner') {
      return new PlanningAgent('codex-cli').invoke(input);
    }
    return new CodingAgentWrapper(new CodexCliAgent()).invoke(input);
  }
}
