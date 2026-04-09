import type { ICodingAgent, CodingAgentOptions, CodingAgentResult } from '../interfaces';
import { resolveCli } from '../../cli-resolver';
import { getExeca } from '../../execa';
import { getModifiedFiles } from '../../git-utils';
import { tmpdir } from 'os';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

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
        const betaMsg = (msg as any).message;
        if (betaMsg?.content && Array.isArray(betaMsg.content)) {
          for (const block of betaMsg.content) {
            if (block.type === 'text' && block.text) {
              opts.onProgress?.({
                type: 'log',
                level: 'info',
                message: `[Claude Code] ${block.text.slice(0, 300)}`,
              });
            }
            if (block.type === 'tool_use') {
              const toolName = block.name ?? 'unknown';
              const input = block.input ?? {};
              let toolMsg = `[Claude Code] 🔧 Tool: ${toolName}`;
              if (toolName === 'Write' || toolName === 'write' || toolName === 'file_write') {
                toolMsg = `[Claude Code] 📝 Writing: ${input.file_path ?? input.path ?? 'file'}`;
              } else if (toolName === 'Read' || toolName === 'read' || toolName === 'file_read') {
                toolMsg = `[Claude Code] 📖 Reading: ${input.file_path ?? input.path ?? 'file'}`;
              } else if (toolName === 'Bash' || toolName === 'bash' || toolName === 'execute_bash') {
                toolMsg = `[Claude Code] 💻 Running: ${(input.command ?? input.cmd ?? '').slice(0, 100)}`;
              } else if (toolName === 'Edit' || toolName === 'edit' || toolName === 'file_edit') {
                toolMsg = `[Claude Code] ✏️ Editing: ${input.file_path ?? input.path ?? 'file'}`;
              }
              opts.onProgress?.({ type: 'log', level: 'info', message: toolMsg });
            }
          }
        }
      }

      if (msg.type === 'tool_use_summary') {
        const summary = (msg as any).summary;
        if (summary) {
          opts.onProgress?.({ type: 'log', level: 'info', message: `[Claude Code] ${summary.slice(0, 300)}` });
        }
      }

      if (msg.type === 'tool_progress') {
        const toolName = (msg as any).tool_name ?? '';
        const elapsed = (msg as any).elapsed_time_seconds ?? 0;
        if (elapsed > 5) {
          opts.onProgress?.({ type: 'log', level: 'info', message: `[Claude Code] ⏳ ${toolName} running (${elapsed.toFixed(0)}s)...` });
        }
      }

      if (msg.type === 'result') {
        const resultMsg = msg as any;
        resultText = resultMsg.result ?? '';
        costUsd = resultMsg.total_cost_usd ?? 0;
        inputTokens = resultMsg.usage?.input_tokens ?? 0;
        outputTokens = resultMsg.usage?.output_tokens ?? 0;
        opts.onProgress?.({ type: 'log', level: 'info', message: `[Claude Code] ✅ Complete (${resultMsg.num_turns ?? '?'} turns, $${costUsd.toFixed(4)})` });
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

    // Write temp MCP config file if local MCP servers are provided
    let mcpConfigPath: string | undefined;
    if (opts.mcpServers && opts.mcpServers.length > 0) {
      const mcpServers: Record<string, any> = {};
      for (const mcp of opts.mcpServers) {
        if (mcp.type === 'local' && mcp.command) {
          mcpServers[mcp.id] = { command: mcp.command, args: mcp.args ?? [] };
        }
      }
      if (Object.keys(mcpServers).length > 0) {
        mcpConfigPath = join(tmpdir(), `autodev-mcp-${Date.now()}.json`);
        writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }));
        args.push('--mcp-config', mcpConfigPath);
        opts.onProgress?.({ type: 'log', level: 'info', message: `[Claude Code CLI] MCP config: ${Object.keys(mcpServers).join(', ')}` });
      }
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

    // Clean up temp MCP config file
    if (mcpConfigPath && existsSync(mcpConfigPath)) {
      try { unlinkSync(mcpConfigPath); } catch { /* non-critical */ }
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
