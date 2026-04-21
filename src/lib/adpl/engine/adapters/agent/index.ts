import type { AgentNodeSpec } from '@/lib/adpl/types/nodes/agent';
import type { NodeAdapter, ExecutionContext, ExecutionOptions, ValidationResult } from '../types';
import type { NodeOutput } from '@/lib/adpl/types';
import type { AgentRole } from './backends/types';
import { resolveBackend, AgentNotImplementedError, AgentValidationError } from './resolver';
import { makeOnProgress } from './streaming';
import { transformInput, buildVerifierInput } from './input-transform';
import { transformOutput, transformVerifierOutput } from './output-transform';

const CODEX_MAX_PROMPT_LENGTH = 12_000;

export const agentAdapter: NodeAdapter<AgentNodeSpec> = {
  type: 'agent',

  defaultTimeout(): number {
    return 120;
  },

  validate(spec: AgentNodeSpec): ValidationResult {
    try {
      resolveBackend(spec.role, spec.model);
      return { valid: true };
    } catch (err) {
      if (err instanceof AgentNotImplementedError || err instanceof AgentValidationError) {
        return { valid: false, errors: [{ message: err.message }] };
      }
      throw err;
    }
  },

  async execute(
    spec: AgentNodeSpec,
    ctx: ExecutionContext,
    options: ExecutionOptions,
  ): Promise<NodeOutput> {
    const backend = resolveBackend(spec.role, spec.model);
    const onProgress = makeOnProgress(ctx, options);
    const role = (spec.role ?? 'planner') as AgentRole;

    if (role === 'verifier') {
      const verifyInput = buildVerifierInput(spec, ctx, onProgress);
      const output = await backend.run(role, verifyInput, ctx, options);
      const codeMetrics = (ctx.$nodes['code'] as NodeOutput | undefined)?.metrics;
      return transformVerifierOutput(output, backend.id, codeMetrics?.promptTruncated);
    }

    const input = transformInput(spec, ctx, onProgress);
    const promptTruncated =
      backend.id === 'codex-cli' && input.prompt.length > CODEX_MAX_PROMPT_LENGTH
        ? true
        : undefined;
    const output = await backend.run(role, input, ctx, options);
    return transformOutput(output, backend.id, promptTruncated);
  },
};
