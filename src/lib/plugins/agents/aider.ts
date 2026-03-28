import type { ICodingAgent, CodingAgentOptions, CodingAgentResult } from '../interfaces';
import { resolveCli } from '../../cli-resolver';

async function getExeca() {
  return (await import('execa')).execa;
}

export class AiderAgent implements ICodingAgent {
  readonly id = 'aider';
  readonly name = 'Aider';
  private resolvedPath: string | null = null;

  async isAvailable(): Promise<boolean> {
    this.resolvedPath = await resolveCli('aider');
    return this.resolvedPath !== null;
  }

  async invoke(opts: CodingAgentOptions): Promise<CodingAgentResult> {
    const cliPath = this.resolvedPath ?? await resolveCli('aider');
    if (!cliPath) throw new Error('Aider not found');
    const startTime = Date.now();
    const execa = await getExeca();
    opts.onProgress?.({ type: 'log', level: 'info', message: '[Aider] Running task...' });
    const args = ['--message', opts.task, '--yes', '--auto-commits'];
    if (opts.testCmd) args.push('--test-cmd', opts.testCmd, '--auto-test');
    if (opts.model) args.push('--model', opts.model);
    const result = await execa(cliPath, args, {
      cwd: opts.projectDir, timeout: opts.timeoutMs ?? 300_000, reject: false, env: { ...process.env },
    });
    const modifiedFiles = await this.getModifiedFiles(opts.projectDir);
    return { success: result.exitCode === 0, text: result.stdout, modifiedFiles, durationMs: Date.now() - startTime, rawOutput: result.stdout };
  }

  private async getModifiedFiles(cwd: string): Promise<string[]> {
    try {
      const execa = await getExeca();
      const { stdout } = await execa('git', ['diff', '--name-only', 'HEAD~1'], { cwd, reject: false });
      if (stdout.trim()) return stdout.split('\n').filter(Boolean);
      const unstaged = await execa('git', ['diff', '--name-only'], { cwd, reject: false });
      return unstaged.stdout.split('\n').filter(Boolean);
    } catch { return []; }
  }
}
