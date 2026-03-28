import waitOn from 'wait-on';

export async function runPortCheck(
  port: number,
  timeoutMs: number = 30_000,
): Promise<{ passed: boolean; actual: string; durationMs: number }> {
  const start = Date.now();
  try {
    await waitOn({
      resources: [`tcp:127.0.0.1:${port}`],
      timeout: timeoutMs,
    });
    return { passed: true, actual: `Port ${port} is listening`, durationMs: Date.now() - start };
  } catch {
    return { passed: false, actual: `Port ${port} not listening after ${timeoutMs}ms`, durationMs: Date.now() - start };
  }
}
