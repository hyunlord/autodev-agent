import type { EngineEvent, EngineEventType, EventHandler, EventOfType } from './types';

type ErrorReporter = (err: unknown, eventType: string) => void;

const defaultErrorReporter: ErrorReporter = (err, eventType) => {
  console.error(`[EventBus] Handler error for event "${eventType}":`, err);
};

export class EventBus {
  private handlers = new Map<string, EventHandler[]>();
  private errorReporter: ErrorReporter;

  constructor(options: { errorReporter?: ErrorReporter } = {}) {
    this.errorReporter = options.errorReporter ?? defaultErrorReporter;
  }

  on<T extends EngineEventType>(type: T, handler: EventHandler<EventOfType<T>>): () => void;
  on(type: '*', handler: EventHandler): () => void;
  on(type: string, handler: EventHandler): () => void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(handler as EventHandler);
    this.handlers.set(type, existing);
    return () => {
      const current = this.handlers.get(type);
      if (!current) return;
      const idx = current.indexOf(handler as EventHandler);
      if (idx >= 0) current.splice(idx, 1);
      if (current.length === 0) this.handlers.delete(type);
    };
  }

  once<T extends EngineEventType>(type: T, handler: EventHandler<EventOfType<T>>): () => void {
    // eslint-disable-next-line prefer-const
    let unsub: (() => void) | undefined;
    const wrapped = ((event: EventOfType<T>) => {
      unsub?.();
      handler(event);
    }) as EventHandler;
    unsub = this.on(type, wrapped as EventHandler<EventOfType<T>>);
    return () => unsub?.();
  }

  emit(event: EngineEvent): void {
    const typeHandlers = this.handlers.get(event.type) ?? [];
    this.invokeAll(typeHandlers, event);
    const wildcardHandlers = this.handlers.get('*') ?? [];
    this.invokeAll(wildcardHandlers, event);
  }

  clear(): void {
    this.handlers.clear();
  }

  listenerCount(type: string): number {
    return this.handlers.get(type)?.length ?? 0;
  }

  listTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  private invokeAll(handlers: EventHandler[], event: EngineEvent): void {
    const copy = handlers.slice();
    for (const handler of copy) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((err) => this.errorReporter(err, event.type));
        }
      } catch (err) {
        this.errorReporter(err, event.type);
      }
    }
  }
}
