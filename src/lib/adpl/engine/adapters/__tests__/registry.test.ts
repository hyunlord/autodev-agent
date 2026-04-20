import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdapterRegistry } from '../registry';
import { MockAdapter } from '../mock';

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  it('register + get adapter by type', () => {
    const mock = new MockAdapter({ type: 'agent' });
    registry.register(mock);

    expect(registry.get('agent')).toBe(mock);
    expect(registry.has('agent')).toBe(true);
  });

  it('get unknown type throws Korean error', () => {
    expect(() => registry.get('unknown')).toThrow(/Adapter type "unknown".*등록되지 않았/);
  });

  it('get error message lists registered types', () => {
    registry.register(new MockAdapter({ type: 'agent' }));
    expect(() => registry.get('shell')).toThrow(/agent/);
  });

  it('list returns all registered types', () => {
    registry.register(new MockAdapter({ type: 'agent' }));
    registry.register(new MockAdapter({ type: 'shell' }));

    expect(registry.list().sort()).toEqual(['agent', 'shell']);
  });

  it('register duplicate warns and overwrites', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = new MockAdapter({ type: 'agent' });
    const second = new MockAdapter({ type: 'agent' });

    registry.register(first);
    registry.register(second);

    expect(registry.get('agent')).toBe(second);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('덮어씁니다'));
    consoleSpy.mockRestore();
  });

  it('unregister removes adapter, returns true; nonexistent returns false', () => {
    registry.register(new MockAdapter({ type: 'agent' }));
    expect(registry.unregister('agent')).toBe(true);
    expect(registry.has('agent')).toBe(false);
    expect(registry.unregister('nonexistent')).toBe(false);
  });

  it('clear removes all adapters', () => {
    registry.register(new MockAdapter({ type: 'agent' }));
    registry.register(new MockAdapter({ type: 'shell' }));
    registry.clear();

    expect(registry.size()).toBe(0);
    expect(registry.list()).toHaveLength(0);
  });

  it('size reflects current count', () => {
    expect(registry.size()).toBe(0);
    registry.register(new MockAdapter({ type: 'agent' }));
    expect(registry.size()).toBe(1);
    registry.register(new MockAdapter({ type: 'shell' }));
    expect(registry.size()).toBe(2);
  });
});
