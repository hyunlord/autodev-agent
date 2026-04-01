import type { ICodingAgent, CodingAgentOptions, CodingAgentResult } from '../interfaces';
import { resolveCli } from '../../cli-resolver';
import { getExeca } from '../../execa';
import { getModifiedFiles } from '../../git-utils';

export class GeminiCliAgent implements ICodingAgent {
  readonly id = 'gemini-cli';
  readonly name = 'Gemini CLI';
  private resolvedPath: string | null = null;

  async isAvailable(): Promise<boolean> {
    this.resolvedPath = await resolveCli('gemini');
    return this.resolvedPath !== null;
  }

  async invoke(opts: CodingAgentOptions): Promise<CodingAgentResult> {
    const cliPath = this.resolvedPath ?? await resolveCli('gemini');
    if (!cliPath) throw new Error('Gemini CLI not found');
    const startTime = Date.now();
    const execa = await getExeca();
    opts.onProgress?.({ type: 'log', level: 'info', message: '[Gemini CLI] Running task...' });
    const args = ['-p', opts.task, '--output-format', 'json', '-y'];
    const result = await execa(cliPath, args, {
      cwd: opts.projectDir, timeout: opts.timeoutMs ?? 300_000, reject: false, env: { ...process.env },
    });
    let resultText = result.stdout;
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      const parsed = JSON.parse(result.stdout);
      resultText = parsed.response ?? parsed.result ?? parsed.text ?? result.stdout;
      costUsd = parsed.stats?.cost_usd ?? 0;
      inputTokens = parsed.stats?.input_tokens ?? 0;
      outputTokens = parsed.stats?.output_tokens ?? 0;
    } catch {
      resultText = result.stdout.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    }
    // Always estimate cost — CLI rarely provides accurate cost data
    // gemini-2.5-pro pricing: $1.25/M input, $10.0/M output
    const estimatedInput = Math.max(inputTokens, Math.ceil(opts.task.length / 4));
    const estimatedOutput = Math.max(outputTokens, Math.ceil(resultText.length / 4));
    if (costUsd === 0 || costUsd < 0.0001) {
      inputTokens = estimatedInput;
      outputTokens = estimatedOutput;
      costUsd = (inputTokens / 1_000_000) * 1.25 + (outputTokens / 1_000_000) * 10.0;
    }
    const modifiedFiles = await getModifiedFiles(opts.projectDir);
    return { success: result.exitCode === 0, text: resultText, modifiedFiles, costUsd, tokenUsage: { inputTokens, outputTokens }, durationMs: Date.now() - startTime, rawOutput: result.stdout };
  }
}
