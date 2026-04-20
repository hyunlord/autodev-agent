export class CancellationError extends Error {
  constructor(
    public reason: string,
    public readonly isCancellation = true,
  ) {
    super(`Operation cancelled: ${reason}`);
    this.name = 'CancellationError';
  }
}

export class CancellationToken {
  private _cancelled = false;
  private _reason = '';
  private listeners: Array<() => void> = [];
  private _abortController: AbortController | null = null;

  cancel(reason: string): void {
    if (this._cancelled) return;
    this._cancelled = true;
    this._reason = reason;

    const toCall = this.listeners.slice();
    this.listeners = [];
    for (const fn of toCall) {
      try {
        fn();
      } catch (err) {
        console.error('[CancellationToken] onCancel listener error:', err);
      }
    }

    if (this._abortController && !this._abortController.signal.aborted) {
      this._abortController.abort(new CancellationError(reason));
    }
  }

  get isCancelled(): boolean {
    return this._cancelled;
  }

  get reason(): string {
    return this._reason;
  }

  onCancel(fn: () => void): () => void {
    if (this._cancelled) {
      try {
        fn();
      } catch (err) {
        console.error('[CancellationToken] immediate onCancel error:', err);
      }
      return () => {};
    }

    this.listeners.push(fn);
    return () => {
      const idx = this.listeners.indexOf(fn);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  throwIfCancelled(): void {
    if (this._cancelled) {
      throw new CancellationError(this._reason);
    }
  }

  get signal(): AbortSignal {
    if (!this._abortController) {
      this._abortController = new AbortController();
      if (this._cancelled) {
        this._abortController.abort(new CancellationError(this._reason));
      }
    }
    return this._abortController.signal;
  }

  listenerCount(): number {
    return this.listeners.length;
  }
}
