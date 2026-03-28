import { execa } from 'execa';

export async function runBuildCheck(
  command: string,
  cwd: string,
): Promise<{ passed: boolean; stdout: string; stderr: string; durationMs: number }> {
  const start = Date.now();
  const result = await execa('sh', ['-c', command], {
    cwd,
    reject: false,
    timeout: 120_000,
  });
  return {
    passed: result.exitCode === 0,
    stdout: result.stdout.slice(-2000),
    stderr: result.stderr.slice(-2000),
    durationMs: Date.now() - start,
  };
}
