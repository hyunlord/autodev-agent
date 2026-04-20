import type { EventBus } from '../bus';
import type { EngineEvent } from '../types';

export interface LoggingSubscriberOptions {
  typePrefixes?: string[];
  log?: (line: string) => void;
  verbose?: boolean;
}

export class LoggingSubscriber {
  private unsubscribe: (() => void) | null = null;

  constructor(private options: LoggingSubscriberOptions = {}) {}

  attach(bus: EventBus): this {
    this.detach();
    this.unsubscribe = bus.on('*', (event) => {
      if (!this.shouldLog(event)) return;
      const line = this.format(event);
      if (this.options.log) {
        this.options.log(line);
      } else {
        console.log(line);
      }
    });
    return this;
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private shouldLog(event: EngineEvent): boolean {
    const prefixes = this.options.typePrefixes;
    if (!prefixes || prefixes.length === 0) return true;
    return prefixes.some((p) => event.type.startsWith(p));
  }

  private format(event: EngineEvent): string {
    const ts = event.timestamp.toISOString();
    const base = `[${ts}] ${event.type} run=${event.runId}`;
    if (!this.options.verbose) return base;
    if (event.type === 'agent.token') {
      return `${base} delta="${(event as { delta: string }).delta?.slice(0, 40)}..."`;
    }
    const { type: _t, timestamp: _ts, runId: _r, ...rest } = event;
    return `${base} ${JSON.stringify(rest)}`;
  }
}
