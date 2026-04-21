import type { AgentOutput } from '@/agents/interfaces';
import type { NodeOutput } from '@/lib/adpl/types';

export function transformOutput(output: AgentOutput): NodeOutput {
  const metrics = {
    durationMs: output.durationMs,
    costUsd: output.costUsd,
    tokensIn: output.tokenUsage.input,
    tokensOut: output.tokenUsage.output,
  };

  if (output.success) {
    return {
      status: 'success',
      data: output.result,
      metrics,
    };
  }

  return {
    status: 'failure',
    error: {
      code: 'agent_failed',
      message: String(output.result) || 'Agent execution failed',
      category: 'persistent',
    },
    metrics,
  };
}
