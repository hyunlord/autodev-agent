import type { CancellationToken } from './token';

export interface GracefulCancelOptions {
  graceMs?: number;
  onTimeout?: () => void | Promise<void>;
}

export async function cancelWithGrace(
  token: CancellationToken,
  reason: string,
  operations: Promise<unknown>[],
  options: GracefulCancelOptions = {},
): Promise<{ gracefulCount: number; timedOutCount: number }> {
  const graceMs = options.graceMs ?? 10_000;

  token.cancel(reason);

  let timedOut = false;
  const graceTimer = new Promise<'timeout'>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve('timeout');
    }, graceMs);
  });

  const results = await Promise.all(
    operations.map(async (op) => {
      const winner = await Promise.race([
        op.then(() => 'done' as const).catch(() => 'done' as const),
        graceTimer,
      ]);
      return winner;
    }),
  );

  const gracefulCount = results.filter((r) => r === 'done').length;
  const timedOutCount = results.length - gracefulCount;

  if (timedOut && timedOutCount > 0 && options.onTimeout) {
    await options.onTimeout();
  }

  return { gracefulCount, timedOutCount };
}
