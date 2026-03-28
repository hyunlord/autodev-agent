import { EventEmitter } from 'events';

class PipelineEventBus extends EventEmitter {
  static get instance(): PipelineEventBus {
    const key = '__autodev_event_bus__';
    if (!(globalThis as any)[key]) {
      const bus = new PipelineEventBus();
      bus.setMaxListeners(100);
      (globalThis as any)[key] = bus;
    }
    return (globalThis as any)[key];
  }
}

export const eventBus = PipelineEventBus.instance;
