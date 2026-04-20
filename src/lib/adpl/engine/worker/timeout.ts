import type { CancellationToken } from '../cancel/token';

export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeoutMs: number,
  ) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Promise 에 timeout 을 걸어 반환.
 * - timeoutMs <= 0 또는 Infinity: timeout 없음 (원본 promise 그대로)
 * - token 이 취소되면 원본 promise reject 가 우선됨
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  _token?: CancellationToken,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0 || !isFinite(timeoutMs)) {
    return promise;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(message, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
