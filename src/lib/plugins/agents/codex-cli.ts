import type { ICodingAgent, CodingAgentOptions, CodingAgentResult } from '../interfaces';
import { resolveCli } from '../../cli-resolver';
import { getExeca } from '../../execa';
import { getModifiedFiles } from '../../git-utils';

export class CodexCliAgent implements ICodingAgent {
  readonly id = 'codex-cli';
  readonly name = 'Codex CLI';
  private resolvedPath: string | null = null;

  async isAvailable(): Promise<boolean> {
    this.resolvedPath = await resolveCli('codex');
    return this.resolvedPath !== null;
  }

  async invoke(opts: CodingAgentOptions): Promise<CodingAgentResult> {
    const cliPath = this.resolvedPath ?? await resolveCli('codex');
    if (!cliPath) throw new Error('Codex CLI not found');
    const startTime = Date.now();
    const execa = await getExeca();
    opts.onProgress?.({ type: 'log', level: 'info', message: '[Codex CLI] Running task...' });

    // Truncate prompt to avoid shell argument length limits
    const truncatedTask = opts.task.slice(0, 8000);

    // Method 1: try with --json flag
    let result = await execa(cliPath, ['exec', truncatedTask, '--full-auto', '--json'], {
      cwd: opts.projectDir, timeout: opts.timeoutMs ?? 300_000, reject: false, env: { ...process.env },
    });

    // Method 2: if no files modified, retry without --json
    const firstModifiedFiles = await getModifiedFiles(opts.projectDir);
    if (firstModifiedFiles.length === 0 && result.exitCode === 0) {
      opts.onProgress?.({ type: 'log', level: 'warn', message: '[Codex CLI] No files modified with --json. Retrying without --json...' });
      result = await execa(cliPath, ['exec', truncatedTask, '--full-auto'], {
        cwd: opts.projectDir, timeout: opts.timeoutMs ?? 300_000, reject: false, env: { ...process.env },
      });
    }

    let resultText = result.stdout;
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      const lines = result.stdout.trim().split('\n').filter(Boolean);
      for (const line of lines.reverse()) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.result || parsed.text) {
            resultText = parsed.result ?? parsed.text ?? resultText;
            costUsd = parsed.cost_usd ?? 0;
            inputTokens = parsed.usage?.input_tokens ?? 0;
            outputTokens = parsed.usage?.output_tokens ?? 0;
            break;
          }
          // Codex JSONL: extract from item.completed
          if (parsed.type === 'item.completed' && parsed.item?.text) {
            resultText = parsed.item.text;
          }
        } catch { continue; }
      }
    } catch { /* use raw stdout */ }

    // Always estimate cost — CLI rarely provides accurate cost data
    // o4-mini pricing: $1.10/M input, $4.40/M output
    const estimatedInput = Math.max(inputTokens, Math.ceil(opts.task.length / 4));
    const estimatedOutput = Math.max(outputTokens, Math.ceil(resultText.length / 4));
    if (costUsd === 0 || costUsd < 0.0001) {
      inputTokens = estimatedInput;
      outputTokens = estimatedOutput;
      costUsd = (inputTokens / 1_000_000) * 1.10 + (outputTokens / 1_000_000) * 4.40;
    }

    const modifiedFiles = await getModifiedFiles(opts.projectDir);
    if (modifiedFiles.length === 0) {
      opts.onProgress?.({ type: 'log', level: 'warn', message: '[Codex CLI] WARNING: No files were created/modified. Codex may not have executed file operations.' });
    }

    return { success: result.exitCode === 0, text: resultText, modifiedFiles, costUsd, tokenUsage: { inputTokens, outputTokens }, durationMs: Date.now() - startTime, rawOutput: result.stdout };
  }
}
