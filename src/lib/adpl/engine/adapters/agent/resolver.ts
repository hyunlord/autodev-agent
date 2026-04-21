import type { AgentBackend, AgentRole, AgentModel } from './backends/types';
import { AutoDevAgentBackend } from './backends/autodev';
import { ClaudeCodeBackend } from './backends/claude-code';
import { GeminiCLIBackend } from './backends/gemini-cli';
import { CodexCLIBackend } from './backends/codex-cli';
import { VerifierBackend } from './backends/verifier';

export class AgentNotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentNotImplementedError';
  }
}

export class AgentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentValidationError';
  }
}

export const ROLE_MODEL_MATRIX: Record<AgentRole, AgentModel[]> = {
  planner: ['autodev-internal', 'claude-code', 'gemini-cli', 'codex-cli'],
  coder: ['autodev-internal', 'claude-code', 'gemini-cli', 'codex-cli'],
  verifier: ['auto-cross-model', 'claude-cli', 'codex-cli', 'gemini-cli'],
};

export function resolveBackend(
  specRole: string | undefined,
  specModel: string | undefined,
): AgentBackend {
  const role = (specRole ?? 'planner') as string;

  if (role === 'verifier') {
    const model = (specModel ?? 'auto-cross-model') as AgentModel;
    const validModels = ROLE_MODEL_MATRIX['verifier'];
    if (!validModels.includes(model)) {
      throw new AgentValidationError(
        `Model "${model}" is not valid for role "verifier". Valid models: ${validModels.join(', ')}.`,
      );
    }
    return new VerifierBackend(model);
  }

  if (role !== 'planner' && role !== 'coder') {
    throw new AgentValidationError(
      `Role "${role}" is not supported. Use 'planner', 'coder', or 'verifier'.`,
    );
  }

  const typedRole = role as 'planner' | 'coder';
  const model = (specModel ?? 'autodev-internal') as string;
  const validModels = ROLE_MODEL_MATRIX[typedRole];

  if (!validModels.includes(model as AgentModel)) {
    throw new AgentValidationError(
      `Model "${model}" is not valid for role "${typedRole}". Valid models: ${validModels.join(', ')}.`,
    );
  }

  switch (model as AgentModel) {
    case 'autodev-internal':
      return new AutoDevAgentBackend();
    case 'claude-code':
      return new ClaudeCodeBackend();
    case 'gemini-cli':
      return new GeminiCLIBackend();
    case 'codex-cli':
      return new CodexCLIBackend();
    default:
      throw new AgentValidationError(
        `Model "${model}" is not valid for role "${typedRole}". Valid models: ${validModels.join(', ')}.`,
      );
  }
}
