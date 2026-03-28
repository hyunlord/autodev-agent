async function getExeca() {
  return (await import('execa')).execa;
}

export interface CliOutputCheckOptions {
  command: string;
  cwd: string;
  expectedExitCode?: number;
  expectedStdout?: string;
  expectedStderr?: string;
  notExpectedStdout?: string;
  timeoutMs?: number;
}

export interface CliOutputResult {
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  actual: string;
  durationMs: number;
}

export async function runCliOutputCheck(opts: CliOutputCheckOptions): Promise<CliOutputResult> {
  const execa = await getExeca();
  const start = Date.now();

  const result = await execa('sh', ['-c', opts.command], {
    cwd: opts.cwd,
    reject: false,
    timeout: opts.timeoutMs ?? 30_000,
  });

  const expectedExit = opts.expectedExitCode ?? 0;
  let passed = result.exitCode === expectedExit;
  const reasons: string[] = [];

  if (result.exitCode !== expectedExit) {
    reasons.push(`Exit code: expected ${expectedExit}, got ${result.exitCode}`);
    passed = false;
  }

  if (opts.expectedStdout && !result.stdout.includes(opts.expectedStdout)) {
    reasons.push(`Stdout missing: "${opts.expectedStdout}"`);
    passed = false;
  }

  if (opts.expectedStderr && !result.stderr.includes(opts.expectedStderr)) {
    reasons.push(`Stderr missing: "${opts.expectedStderr}"`);
    passed = false;
  }

  if (opts.notExpectedStdout && result.stdout.includes(opts.notExpectedStdout)) {
    reasons.push(`Stdout should not contain: "${opts.notExpectedStdout}"`);
    passed = false;
  }

  return {
    passed,
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.slice(-2000),
    stderr: result.stderr.slice(-2000),
    actual: passed ? 'All checks passed' : reasons.join('; '),
    durationMs: Date.now() - start,
  };
}
