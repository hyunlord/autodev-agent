import type { AgentNodeSpec } from '@/lib/adpl/types/nodes/agent';
import type { NodeAdapter, ExecutionContext, ExecutionOptions, ValidationResult } from '../types';
import type { NodeOutput } from '@/lib/adpl/types';
import type { AgentRole } from './backends/types';
import { resolveBackend, AgentNotImplementedError, AgentValidationError } from './resolver';
import { makeOnProgress } from './streaming';
import { transformInput } from './input-transform';
import { transformOutput } from './output-transform';

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
    const input = transformInput(spec, ctx, onProgress);
    const role = (spec.role ?? 'planner') as AgentRole;
    const output = await backend.run(role, input, ctx, options);
    return transformOutput(output);
  },
};
