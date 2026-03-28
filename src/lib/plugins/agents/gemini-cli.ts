import type { ICodingAgent, CodingAgentOptions, CodingAgentResult } from '../interfaces';
import { resolveCli } from '../../cli-resolver';

async function getExeca() {
  return (await import('execa')).execa;
}

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
    const modifiedFiles = await this.getModifiedFiles(opts.projectDir);
    return { success: result.exitCode === 0, text: resultText, modifiedFiles, costUsd, tokenUsage: { inputTokens, outputTokens }, durationMs: Date.now() - startTime, rawOutput: result.stdout };
  }

  private async getModifiedFiles(cwd: string): Promise<string[]> {
    try {
      const execa = await getExeca();
      const { stdout } = await execa('git', ['diff', '--name-only'], { cwd, reject: false });
      const staged = await execa('git', ['diff', '--name-only', '--cached'], { cwd, reject: false });
      return [...new Set([...stdout.split('\n'), ...staged.stdout.split('\n')].filter(Boolean))];
    } catch { return []; }
  }
}
