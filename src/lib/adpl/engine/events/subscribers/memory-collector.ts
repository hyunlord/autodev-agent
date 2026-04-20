import type { EventBus } from '../bus';
import type { EngineEvent, EngineEventType } from '../types';

export class MemoryEventCollector {
  private events: EngineEvent[] = [];
  private unsubscribe: (() => void) | null = null;

  attach(bus: EventBus): this {
    this.unsubscribe = bus.on('*', (event) => {
      this.events.push(event);
    });
    return this;
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  all(): EngineEvent[] {
    return this.events.slice();
  }

  ofType<T extends EngineEventType>(type: T): Extract<EngineEvent, { type: T }>[] {
    return this.events.filter((e) => e.type === type) as Extract<EngineEvent, { type: T }>[];
  }

  forRun(runId: string): EngineEvent[] {
    return this.events.filter((e) => e.runId === runId);
  }

  count(): number {
    return this.events.length;
  }

  clear(): void {
    this.events = [];
  }
}
