import type { NodeAdapter } from './types';
import { agentAdapter } from './agent';
import { shellAdapter } from './shell';
import { httpAdapter } from './http';
import { webhookOutAdapter } from './webhook-out';

export class AdapterRegistry {
  private adapters = new Map<string, NodeAdapter>();

  register(adapter: NodeAdapter): void {
    if (this.adapters.has(adapter.type)) {
      console.warn(
        `[AdapterRegistry] Adapter type "${adapter.type}" 가 이미 등록되어 있습니다. 덮어씁니다.`,
      );
    }
    this.adapters.set(adapter.type, adapter);
  }

  get(type: string): NodeAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      const registered = Array.from(this.adapters.keys()).join(', ') || '(없음)';
      throw new Error(
        `[AdapterRegistry] Adapter type "${type}" 가 등록되지 않았습니다. ` +
          `등록된 타입: ${registered}`,
      );
    }
    return adapter;
  }

  has(type: string): boolean {
    return this.adapters.has(type);
  }

  list(): string[] {
    return Array.from(this.adapters.keys());
  }

  unregister(type: string): boolean {
    return this.adapters.delete(type);
  }

  clear(): void {
    this.adapters.clear();
  }

  size(): number {
    return this.adapters.size;
  }
}

export function createDefaultRegistry(): AdapterRegistry {
  const r = new AdapterRegistry();
  r.register(agentAdapter);
  r.register(shellAdapter);
  r.register(httpAdapter);
  r.register(webhookOutAdapter);
  return r;
}
