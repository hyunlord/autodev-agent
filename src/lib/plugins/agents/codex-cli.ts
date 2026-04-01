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
    const args = ['exec', opts.task, '--full-auto', '--json'];
    const result = await execa(cliPath, args, {
      cwd: opts.projectDir, timeout: opts.timeoutMs ?? 300_000, reject: false, env: { ...process.env },
    });
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
        } catch { continue; }
      }
    } catch { /* use raw stdout */ }
    // Estimate cost if not provided by CLI (o4-mini pricing)
    if (costUsd === 0) {
      inputTokens = inputTokens || Math.ceil(opts.task.length / 4);
      outputTokens = outputTokens || Math.ceil(resultText.length / 4);
      costUsd = (inputTokens / 1_000_000) * 1.10 + (outputTokens / 1_000_000) * 4.40;
    }
    const modifiedFiles = await getModifiedFiles(opts.projectDir);
    return { success: result.exitCode === 0, text: resultText, modifiedFiles, costUsd, tokenUsage: { inputTokens, outputTokens }, durationMs: Date.now() - startTime, rawOutput: result.stdout };
  }
}
