import type { ICodingAgent, CodingAgentOptions, CodingAgentResult } from '../interfaces';
import { resolveCli } from '../../cli-resolver';
import { getExeca } from '../../execa';
import { getModifiedFiles } from '../../git-utils';

export class ClaudeCodeAgent implements ICodingAgent {
  readonly id = 'claude-code';
  readonly name = 'Claude Code';
  private resolvedPath: string | null = null;

  async isAvailable(): Promise<boolean> {
    this.resolvedPath = await resolveCli('claude');
    return this.resolvedPath !== null;
  }

  async invoke(opts: CodingAgentOptions): Promise<CodingAgentResult> {
    try {
      return await this.invokeViaSdk(opts);
    } catch (sdkError) {
      opts.onProgress?.({
        type: 'log',
        level: 'warn',
        message: `Claude Code SDK not available, falling back to CLI: ${sdkError}`,
      });
      return await this.invokeViaCli(opts);
    }
  }

  private async invokeViaSdk(opts: CodingAgentOptions): Promise<CodingAgentResult> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const startTime = Date.now();
    let resultText = '';
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const msg of query({
      prompt: opts.task,
      options: {
        cwd: opts.projectDir,
        allowedTools: ['Read', 'Write', 'Bash'],
        maxTurns: opts.maxTurns ?? 20,
      },
    })) {
      if (msg.type === 'assistant') {
        opts.onProgress?.({
          type: 'log',
          level: 'info',
          message: `[Claude Code] ${typeof (msg as any).message === 'string' ? String((msg as any).message).slice(0, 200) : 'Working...'}`,
        });
      }
      if (msg.type === 'result') {
        resultText = (msg as any).result ?? '';
        costUsd = (msg as any).total_cost_usd ?? 0;
        inputTokens = (msg as any).usage?.input_tokens ?? 0;
        outputTokens = (msg as any).usage?.output_tokens ?? 0;
      }
    }

    const modifiedFiles = await getModifiedFiles(opts.projectDir);

    return {
      success: true,
      text: resultText,
      modifiedFiles,
      costUsd,
      tokenUsage: { inputTokens, outputTokens },
      durationMs: Date.now() - startTime,
    };
  }

  private async invokeViaCli(opts: CodingAgentOptions): Promise<CodingAgentResult> {
    const startTime = Date.now();

    const args = [
      '-p', opts.task,
      '--output-format', 'json',
      '--max-turns', String(opts.maxTurns ?? 20),
      '--dangerously-skip-permissions',
    ];

    if (opts.model) {
      args.push('--model', opts.model);
    }

    opts.onProgress?.({
      type: 'log',
      level: 'info',
      message: `[Claude Code CLI] Running with max ${opts.maxTurns ?? 20} turns...`,
    });

    const cliPath = this.resolvedPath ?? await resolveCli('claude');
    if (!cliPath) throw new Error('Claude CLI not found');
    const execa = await getExeca();
    const result = await execa(cliPath, args, {
      cwd: opts.projectDir,
      timeout: opts.timeoutMs ?? 300_000,
      reject: false,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
    });

    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let resultText = result.stdout;

    try {
      const parsed = JSON.parse(result.stdout);
      resultText = parsed.result ?? parsed.text ?? result.stdout;
      costUsd = parsed.cost_usd ?? parsed.total_cost_usd ?? 0;
      inputTokens = parsed.usage?.input_tokens ?? 0;
      outputTokens = parsed.usage?.output_tokens ?? 0;
    } catch {
      // stdout was not JSON, use raw text
    }

    const modifiedFiles = await getModifiedFiles(opts.projectDir);

    return {
      success: result.exitCode === 0,
      text: resultText,
      modifiedFiles,
      costUsd,
      tokenUsage: { inputTokens, outputTokens },
      durationMs: Date.now() - startTime,
      rawOutput: result.stdout,
    };
  }
}
