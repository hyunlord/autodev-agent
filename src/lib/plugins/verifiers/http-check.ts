export async function runHttpCheck(
  url: string,
  timeoutMs: number = 10_000,
): Promise<{ passed: boolean; statusCode: number; actual: string; durationMs: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return {
      passed: response.status >= 200 && response.status < 400,
      statusCode: response.status,
      actual: `HTTP ${response.status}`,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      passed: false,
      statusCode: 0,
      actual: `HTTP request failed: ${e instanceof Error ? e.message : String(e)}`,
      durationMs: Date.now() - start,
    };
  }
}
