import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';
import { buildStdin, injectStdin } from '../stdin-injector';

function makeMockChild(stdin: PassThrough): ChildProcess {
  return { stdin } as unknown as ChildProcess;
}

async function collectStream(stream: PassThrough): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

describe('buildStdin', () => {
  it('returns null when spec.stdin is undefined', () => {
    expect(buildStdin({})).toBeNull();
  });

  it('returns null when spec.stdin is empty string', () => {
    expect(buildStdin({ stdin: '' })).toBeNull();
  });

  it('returns Buffer from spec.stdin string', () => {
    const buf = buildStdin({ stdin: 'hello world' });
    expect(buf).not.toBeNull();
    expect(buf!.toString('utf-8')).toBe('hello world');
  });
});

describe('injectStdin', () => {
  it('writes small payload (< 16KB) in one shot and ends', async () => {
    const pt = new PassThrough();
    const child = makeMockChild(pt);
    const payload = Buffer.from('small payload');

    const collectPromise = collectStream(pt);
    await injectStdin(child, payload);
    const collected = await collectPromise;

    expect(collected.toString('utf-8')).toBe('small payload');
  });

  it('writes exactly 16KB in one shot (boundary)', async () => {
    const pt = new PassThrough();
    const child = makeMockChild(pt);
    const payload = Buffer.alloc(16 * 1024, 'x');

    const collectPromise = collectStream(pt);
    await injectStdin(child, payload);
    const collected = await collectPromise;

    expect(collected.length).toBe(16 * 1024);
  });

  it('writes large payload (> 16KB) in chunks and ends', async () => {
    const pt = new PassThrough();
    const child = makeMockChild(pt);
    const payload = Buffer.alloc(20 * 1024, 'a');

    const collectPromise = collectStream(pt);
    await injectStdin(child, payload);
    const collected = await collectPromise;

    expect(collected.length).toBe(20 * 1024);
    expect(collected.every((b) => b === 'a'.charCodeAt(0))).toBe(true);
  });

  it('writes 100KB payload correctly', async () => {
    const pt = new PassThrough();
    const child = makeMockChild(pt);
    const payload = Buffer.alloc(100 * 1024, 'z');

    const collectPromise = collectStream(pt);
    await injectStdin(child, payload);
    const collected = await collectPromise;

    expect(collected.length).toBe(100 * 1024);
  });

  it('does nothing when child.stdin is null', async () => {
    const child = { stdin: null } as unknown as ChildProcess;
    await expect(injectStdin(child, Buffer.from('test'))).resolves.toBeUndefined();
  });
});
