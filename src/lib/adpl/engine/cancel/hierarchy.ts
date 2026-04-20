import { CancellationToken } from './token';

export function createChildToken(parent: CancellationToken): CancellationToken {
  const child = new CancellationToken();

  if (parent.isCancelled) {
    child.cancel(parent.reason);
    return child;
  }

  parent.onCancel(() => {
    if (!child.isCancelled) {
      child.cancel(parent.reason);
    }
  });

  return child;
}

export function createChildFromAny(parents: CancellationToken[]): CancellationToken {
  const child = new CancellationToken();

  const alreadyCancelled = parents.find((p) => p.isCancelled);
  if (alreadyCancelled) {
    child.cancel(alreadyCancelled.reason);
    return child;
  }

  const unsubs = parents.map((p) =>
    p.onCancel(() => {
      if (!child.isCancelled) {
        child.cancel(p.reason);
      }
    }),
  );

  child.onCancel(() => {
    for (const unsub of unsubs) unsub();
  });

  return child;
}
