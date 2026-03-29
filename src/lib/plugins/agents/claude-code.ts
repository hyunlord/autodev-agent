import type { ICodingAgent, CodingAgentOptions, CodingAgentResult } from '../interfaces';
import { resolveCli } from '../../cli-resolver';
import { getExeca } from '../../execa';
import { getModifiedFiles } from '../../git-utils';

function formatClaudeEvent(event: any): string | null {
  if (event.type === 'assistant' && event.message) {
    const content = typeof event.message === 'string'
      ? event.message
      : Array.isArray(event.message?.content)
        ? event.message.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join(' ')
        : null;
    if (content) return `[Claude Code] ${content.slice(0, 300)}`;
  }

  if (event.type === 'tool_use' || event.subtype === 'tool_use') {
    const toolName = event.name ?? event.tool ?? 'unknown';
    const input = event.input ?? {};

    if (toolName === 'Write' || toolName === 'write') {
      return `[Claude Code] 📝 Writing: ${input.file_path ?? input.path ?? 'file'}`;
    }
    if (toolName === 'Read' || toolName === 'read') {
      return `[Claude Code] 📖 Reading: ${input.file_path ?? input.path ?? 'file'}`;
    }
    if (toolName === 'Bash' || toolName === 'bash') {
      const cmd = (input.command ?? input.cmd ?? '').slice(0, 100);
      return `[Claude Code] 💻 Running: ${cmd}`;
    }
    if (toolName === 'Edit' || toolName === 'edit') {
      return `[Claude Code] ✏️ Editing: ${input.file_path ?? input.path ?? 'file'}`;
    }
    return `[Claude Code] 🔧 Tool: ${toolName}`;
  }

  if (event.type === 'tool_result' || event.subtype === 'tool_result') {
    return null;
  }

  if (event.type === 'result') {
    return `[Claude Code] ✅ Task complete`;
  }

  if (event.type === 'error') {
    return `[Claude Code] ❌ Error: ${(event.error ?? event.message ?? '').slice(0, 200)}`;
  }

  if (event.type === 'system') {
    return `[Claude Code] ${(event.message ?? event.text ?? '').slice(0, 200)}`;
  }

  return null;
}

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

    const cliPath = this.resolvedPath ?? await resolveCli('claude');
    if (!cliPath) throw new Error('Claude CLI not found');
    const execa = await getExeca();

    const args = [
      '-p', opts.task,
      '--output-format', 'stream-json',
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

    const childProcess = execa(cliPath, args, {
      cwd: opts.projectDir,
      timeout: opts.timeoutMs ?? 300_000,
      reject: false,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
    });

    let resultText = '';
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let fullStdout = '';

    if (childProcess.stdout) {
      let buffer = '';
      childProcess.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          fullStdout += line + '\n';

          try {
            const event = JSON.parse(line);
            const progressMsg = formatClaudeEvent(event);
            if (progressMsg) {
              opts.onProgress?.({
                type: 'log',
                level: 'info',
                message: progressMsg,
              });
            }

            if (event.type === 'result') {
              resultText = event.result ?? event.text ?? '';
              costUsd = event.cost_usd ?? event.total_cost_usd ?? 0;
              inputTokens = event.usage?.input_tokens ?? 0;
              outputTokens = event.usage?.output_tokens ?? 0;
            }
          } catch {
            if (line.trim().length > 0 && !line.startsWith('{')) {
              opts.onProgress?.({
                type: 'log',
                level: 'info',
                message: `[Claude Code] ${line.slice(0, 300)}`,
              });
            }
          }
        }
      });
    }

    const result = await childProcess;

    if (fullStdout === '' && result.stdout) {
      fullStdout = result.stdout;
      try {
        const parsed = JSON.parse(result.stdout);
        resultText = parsed.result ?? parsed.text ?? result.stdout;
        costUsd = parsed.cost_usd ?? parsed.total_cost_usd ?? 0;
        inputTokens = parsed.usage?.input_tokens ?? 0;
        outputTokens = parsed.usage?.output_tokens ?? 0;
      } catch {
        resultText = result.stdout;
      }
    }

    const modifiedFiles = await getModifiedFiles(opts.projectDir);

    return {
      success: result.exitCode === 0,
      text: resultText,
      modifiedFiles,
      costUsd,
      tokenUsage: { inputTokens, outputTokens },
      durationMs: Date.now() - startTime,
      rawOutput: fullStdout,
    };
  }
}
