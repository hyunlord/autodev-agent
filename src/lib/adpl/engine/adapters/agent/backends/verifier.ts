import type { AgentInput, AgentOutput } from '@/agents/interfaces';
import type { ExecutionContext, ExecutionOptions } from '../../types';
import type { AgentBackend, AgentModel, AgentRole } from './types';
import type { NodeOutput } from '@/lib/adpl/types';
import { VerifyAgent } from '@/agents/verify/verify-agent';

export class VerifierBackend implements AgentBackend {
  readonly id: AgentModel;

  constructor(model: AgentModel) {
    this.id = model;
  }

  async run(
    _role: AgentRole,
    input: AgentInput,
    ctx: ExecutionContext,
    _options: ExecutionOptions,
  ): Promise<AgentOutput> {
    let verifyAgent: VerifyAgent;

    if (this.id === 'auto-cross-model') {
      const coderModel: string =
        (ctx.$nodes['code'] as NodeOutput | undefined)?.metrics?.agentModel ?? 'autodev-internal';
      verifyAgent = (await VerifyAgent.selectDifferentFrom(coderModel)).primary;
    } else {
      verifyAgent = new VerifyAgent(this.id);
    }

    return verifyAgent.invoke(input);
  }
}
