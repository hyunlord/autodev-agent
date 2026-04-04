import type { IAgent, AgentInput, AgentOutput } from '../interfaces';
import type { ICodingAgent, CodingAgentOptions, McpServerInfo } from '../../lib/plugins/interfaces';

export interface CodingOutput extends AgentOutput {
  result: {
    text: string;
    modifiedFiles: string[];
  };
}

export class CodingAgentWrapper implements IAgent {
  readonly id: string;
  readonly name: string;
  readonly role = 'coding' as const;
  private inner: ICodingAgent;

  constructor(inner: ICodingAgent) {
    this.inner = inner;
    this.id = inner.id;
    this.name = inner.name;
  }

  async isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }

  async invoke(input: AgentInput): Promise<CodingOutput> {
    const opts: CodingAgentOptions = {
      task: input.prompt,
      projectDir: input.context.projectDir,
      maxBudgetUsd: input.config.maxBudgetUsd,
      timeoutMs: input.config.timeoutMs,
      mcpServers: input.context.mcpServers as McpServerInfo[] | undefined,
      onProgress: input.onProgress,
    };

    const result = await this.inner.invoke(opts);

    return {
      success: result.success,
      result: {
        text: result.text,
        modifiedFiles: result.modifiedFiles,
      },
      costUsd: result.costUsd ?? 0,
      tokenUsage: {
        input: result.tokenUsage?.inputTokens ?? 0,
        output: result.tokenUsage?.outputTokens ?? 0,
      },
      durationMs: result.durationMs,
      rawOutput: result.rawOutput as string | undefined,
    };
  }

  /** Get the underlying ICodingAgent (for backward compatibility) */
  getInner(): ICodingAgent {
    return this.inner;
  }
}
