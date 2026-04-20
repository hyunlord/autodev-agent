import { describe, it, expect } from 'vitest';
import { CancellationToken } from '../token';
import { createChildToken, createChildFromAny } from '../hierarchy';

describe('createChildToken', () => {
  it('parent cancel propagates to child', () => {
    const parent = new CancellationToken();
    const child = createChildToken(parent);
    expect(child.isCancelled).toBe(false);
    parent.cancel('parent stop');
    expect(child.isCancelled).toBe(true);
    expect(child.reason).toBe('parent stop');
  });

  it('child cancel does not affect parent', () => {
    const parent = new CancellationToken();
    const child = createChildToken(parent);
    child.cancel('child only');
    expect(child.isCancelled).toBe(true);
    expect(parent.isCancelled).toBe(false);
  });

  it('parent already cancelled: child immediately cancelled', () => {
    const parent = new CancellationToken();
    parent.cancel('preexisting');
    const child = createChildToken(parent);
    expect(child.isCancelled).toBe(true);
    expect(child.reason).toBe('preexisting');
  });

  it('deep hierarchy: grandparent cancel propagates', () => {
    const grandparent = new CancellationToken();
    const parent = createChildToken(grandparent);
    const child = createChildToken(parent);
    grandparent.cancel('top level');
    expect(parent.isCancelled).toBe(true);
    expect(child.isCancelled).toBe(true);
  });
});

describe('createChildFromAny', () => {
  it('child cancelled when any parent cancelled', () => {
    const p1 = new CancellationToken();
    const p2 = new CancellationToken();
    const p3 = new CancellationToken();
    const child = createChildFromAny([p1, p2, p3]);
    p2.cancel('p2 triggered');
    expect(child.isCancelled).toBe(true);
    expect(child.reason).toBe('p2 triggered');
    expect(p1.isCancelled).toBe(false);
    expect(p3.isCancelled).toBe(false);
  });

  it('one parent already cancelled: child immediate', () => {
    const p1 = new CancellationToken();
    const p2 = new CancellationToken();
    p2.cancel('pre');
    const child = createChildFromAny([p1, p2]);
    expect(child.isCancelled).toBe(true);
    expect(child.reason).toBe('pre');
  });

  it('child cancelled first: unsubscribes from parents (leak 방지)', () => {
    const p1 = new CancellationToken();
    const p2 = new CancellationToken();
    const child = createChildFromAny([p1, p2]);
    const initialCount = p1.listenerCount() + p2.listenerCount();
    child.cancel('child first');
    expect(p1.listenerCount() + p2.listenerCount()).toBeLessThan(initialCount);
  });

  it('use case: race of pipeline-cancel vs user-cancel vs timeout', () => {
    const pipelineToken = new CancellationToken();
    const userToken = new CancellationToken();
    const timeoutToken = new CancellationToken();
    const nodeToken = createChildFromAny([pipelineToken, userToken, timeoutToken]);
    userToken.cancel('user clicked stop');
    expect(nodeToken.isCancelled).toBe(true);
    expect(nodeToken.reason).toBe('user clicked stop');
  });
});
