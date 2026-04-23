import type { FlowNodeHandler } from './flow-handler';
import { parallelHandler } from './handlers/parallel-handler';
import { branchHandler } from './handlers/branch-handler';

const FLOW_NODE_TYPES = new Set(['parallel', 'branch', 'loop', 'gate']);

export function isFlowNode(type: string): boolean {
  return FLOW_NODE_TYPES.has(type);
}

export class FlowRegistry {
  private handlers = new Map<string, FlowNodeHandler>();

  register(handler: FlowNodeHandler): void {
    this.handlers.set(handler.type, handler);
  }

  get(type: string): FlowNodeHandler {
    const h = this.handlers.get(type);
    if (!h) {
      throw new Error(`[FlowRegistry] No handler registered for flow type "${type}"`);
    }
    return h;
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }
}

export function createDefaultFlowRegistry(): FlowRegistry {
  const r = new FlowRegistry();
  r.register(parallelHandler);
  r.register(branchHandler);
  return r;
}
