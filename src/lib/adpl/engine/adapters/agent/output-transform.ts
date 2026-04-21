import type { AgentOutput, VerifyResult } from '@/agents/interfaces';
import type { NodeOutput } from '@/lib/adpl/types';

export function transformOutput(
  output: AgentOutput,
  agentModel?: string,
  promptTruncated?: boolean,
): NodeOutput {
  const metrics = {
    durationMs: output.durationMs,
    costUsd: output.costUsd,
    tokensIn: output.tokenUsage.input,
    tokensOut: output.tokenUsage.output,
    agentModel,
    promptTruncated,
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

const SCORE_CAP_ON_TRUNCATION = 85;

export function transformVerifierOutput(
  output: AgentOutput,
  agentModel?: string,
  promptTruncated?: boolean,
): NodeOutput {
  const base = transformOutput(output, agentModel, promptTruncated);

  if (base.status === 'success' && promptTruncated) {
    const result = base.data as VerifyResult | undefined;
    if (result && typeof result.score === 'number' && result.score > SCORE_CAP_ON_TRUNCATION) {
      return {
        ...base,
        data: { ...result, score: SCORE_CAP_ON_TRUNCATION },
      };
    }
  }

  return base;
}
