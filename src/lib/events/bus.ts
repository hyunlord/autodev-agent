import { EventEmitter } from 'events';

class PipelineEventBus extends EventEmitter {
  private static _instance: PipelineEventBus;
  static get instance(): PipelineEventBus {
    if (!this._instance) {
      this._instance = new PipelineEventBus();
      this._instance.setMaxListeners(100);
    }
    return this._instance;
  }
}

export const eventBus = PipelineEventBus.instance;
