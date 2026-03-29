import type { ICodingAgent, CodingAgentOptions, CodingAgentResult } from '../interfaces';
import { resolveCli } from '../../cli-resolver';
import { getExeca } from '../../execa';
import { getModifiedFiles } from '../../git-utils';

export class ClineCliAgent implements ICodingAgent {
  readonly id = 'cline-cli';
  readonly name = 'Cline CLI';
  private resolvedPath: string | null = null;

  async isAvailable(): Promise<boolean> {
    this.resolvedPath = await resolveCli('cline');
    return this.resolvedPath !== null;
  }

  async invoke(opts: CodingAgentOptions): Promise<CodingAgentResult> {
    const cliPath = this.resolvedPath ?? await resolveCli('cline');
    if (!cliPath) throw new Error('Cline CLI not found');
    const startTime = Date.now();
    const execa = await getExeca();
    opts.onProgress?.({ type: 'log', level: 'info', message: '[Cline CLI] Running task...' });
    const args = ['-y', '--json', opts.task];
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
          if (parsed.type === 'result' || parsed.result) {
            resultText = parsed.result ?? parsed.text ?? resultText;
            costUsd = parsed.cost_usd ?? parsed.totalCost ?? 0;
            inputTokens = parsed.usage?.input_tokens ?? 0;
            outputTokens = parsed.usage?.output_tokens ?? 0;
            break;
          }
        } catch { continue; }
      }
    } catch { /* use raw stdout */ }
    const modifiedFiles = await getModifiedFiles(opts.projectDir);
    return { success: result.exitCode === 0, text: resultText, modifiedFiles, costUsd, tokenUsage: { inputTokens, outputTokens }, durationMs: Date.now() - startTime, rawOutput: result.stdout };
  }
}
