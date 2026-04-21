import type { AgentInput, AgentOutput } from '@/agents/interfaces';
import type { PipelineEvent } from '@/lib/types';
import type { ExecutionContext, ExecutionOptions } from '../../types';
import type { AgentBackend, AgentRole } from './types';
import { PlanningAgent } from '@/agents/planning/planning-agent';
import { CodingAgentWrapper } from '@/agents/coding/coding-agent';
import { ClaudeCodeAgent } from '@/lib/plugins/agents/claude-code';
import { emitFallback } from '../streaming';

export class ClaudeCodeBackend implements AgentBackend {
  readonly id = 'claude-code' as const;

  async run(
    role: AgentRole,
    input: AgentInput,
    ctx: ExecutionContext,
    options: ExecutionOptions,
  ): Promise<AgentOutput> {
    const originalOnProgress = input.onProgress;

    const wrappedOnProgress = (event: PipelineEvent) => {
      if (
        event.type === 'log' &&
        event.level === 'warn' &&
        event.message.includes('falling back to CLI')
      ) {
        emitFallback(ctx, options, 'sdk', 'cli', event.message);
      }
      originalOnProgress?.(event);
    };

    const wrappedInput: AgentInput = { ...input, onProgress: wrappedOnProgress };

    if (role === 'planner') {
      return new PlanningAgent().invoke(wrappedInput);
    }
    return new CodingAgentWrapper(new ClaudeCodeAgent()).invoke(wrappedInput);
  }
}
