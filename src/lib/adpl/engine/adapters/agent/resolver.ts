import type { AgentBackend, AgentRole, AgentModel } from './backends/types';
import { AutoDevAgentBackend } from './backends/autodev';
import { ClaudeCodeBackend } from './backends/claude-code';
import { GeminiCLIBackend } from './backends/gemini-cli';
import { CodexCLIBackend } from './backends/codex-cli';

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
};

export function resolveBackend(
  specRole: string | undefined,
  specModel: string | undefined,
): AgentBackend {
  const role = (specRole ?? 'planner') as string;

  if (role === 'verifier') {
    throw new AgentNotImplementedError('verifier is not implemented; reserved for C7-1.5');
  }

  if (role !== 'planner' && role !== 'coder') {
    throw new AgentValidationError(`Role "${role}" is not supported. Use 'planner' or 'coder'.`);
  }

  const typedRole = role as AgentRole;
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
  }
}
