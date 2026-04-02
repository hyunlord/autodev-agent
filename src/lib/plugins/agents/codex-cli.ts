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

    // ─── Method 1: codex exec with proper sandbox flags ─────
    // --sandbox workspace-write is CRITICAL: default sandbox is read-only
    const baseArgs = [
      'exec',
      '--full-auto',
      '--sandbox', 'workspace-write',
      '--json',
    ];

    let result;

    if (opts.task.length > 4000) {
      // Long prompt: pipe via stdin using '-' as prompt argument
      opts.onProgress?.({ type: 'log', level: 'info', message: '[Codex CLI] Using stdin for long prompt...' });
      result = await execa(cliPath, [...baseArgs, '-'], {
        cwd: opts.projectDir,
        timeout: opts.timeoutMs ?? 300_000,
        reject: false,
        env: { ...process.env },
        input: opts.task,
      });
    } else {
      // Short prompt: pass as final argument (flags first, prompt last)
      result = await execa(cliPath, [...baseArgs, opts.task], {
        cwd: opts.projectDir,
        timeout: opts.timeoutMs ?? 300_000,
        reject: false,
        env: { ...process.env },
      });
    }

    const parsed = await this.parseResult(result, opts, startTime);

    // ─── Fallback: if no files, retry without --json ────────
    if (parsed.modifiedFiles.length === 0 && result.exitCode === 0) {
      opts.onProgress?.({ type: 'log', level: 'warn', message: '[Codex CLI] No files with --json. Retrying without --json...' });

      const retryResult = await execa(cliPath, [
        'exec',
        '--full-auto',
        '--sandbox', 'workspace-write',
        opts.task.slice(0, 8000),
      ], {
        cwd: opts.projectDir,
        timeout: opts.timeoutMs ?? 300_000,
        reject: false,
        env: { ...process.env },
      });

      const retryParsed = await this.parseResult(retryResult, opts, startTime);
      if (retryParsed.modifiedFiles.length > 0) {
        return retryParsed;
      }
    }

    if (parsed.modifiedFiles.length === 0) {
      opts.onProgress?.({ type: 'log', level: 'warn', message: '[Codex CLI] WARNING: No files were created/modified. Check Codex CLI sandbox permissions and authentication.' });
    }

    return parsed;
  }

  private async parseResult(
    result: { exitCode?: number | null; stdout: string; stderr?: string },
    opts: CodingAgentOptions,
    startTime: number,
  ): Promise<CodingAgentResult> {
    let resultText = result.stdout;
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    // Parse JSONL output
    try {
      const lines = result.stdout.trim().split('\n').filter(Boolean);
      for (const line of lines.reverse()) {
        try {
          const parsed = JSON.parse(line);

          // Codex JSONL: extract from item.completed
          if (parsed.type === 'item.completed') {
            if (parsed.item?.type === 'agent_message' || parsed.item?.type === 'result') {
              resultText = parsed.item.text ?? resultText;
            }
          }

          // Direct result/text fields
          if (parsed.result || parsed.text) {
            resultText = parsed.result ?? parsed.text ?? resultText;
            costUsd = parsed.cost_usd ?? 0;
            inputTokens = parsed.usage?.input_tokens ?? 0;
            outputTokens = parsed.usage?.output_tokens ?? 0;
            break;
          }
        } catch { continue; }
      }
    } catch { /* use raw stdout */ }

    // Always estimate cost — o4-mini pricing: $1.10/M input, $4.40/M output
    const estimatedInput = Math.max(inputTokens, Math.ceil(opts.task.length / 4));
    const estimatedOutput = Math.max(outputTokens, Math.ceil(resultText.length / 4));
    if (costUsd === 0 || costUsd < 0.0001) {
      inputTokens = estimatedInput;
      outputTokens = estimatedOutput;
      costUsd = (inputTokens / 1_000_000) * 1.10 + (outputTokens / 1_000_000) * 4.40;
    }

    const modifiedFiles = await getModifiedFiles(opts.projectDir);

    return {
      success: (result.exitCode ?? 1) === 0,
      text: resultText,
      modifiedFiles,
      costUsd,
      tokenUsage: { inputTokens, outputTokens },
      durationMs: Date.now() - startTime,
      rawOutput: result.stdout,
    };
  }
}
