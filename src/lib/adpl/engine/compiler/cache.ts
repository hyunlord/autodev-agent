import type { ExecutionPlan } from './types';

const TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  plan: ExecutionPlan;
  expiresAt: number;
}

export class CompileCache {
  private store = new Map<string, CacheEntry>();

  set(key: string, plan: ExecutionPlan): void {
    this.store.set(key, { plan, expiresAt: Date.now() + TTL_MS });
  }

  get(key: string): ExecutionPlan | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.plan;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
