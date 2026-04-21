import type { ChildProcess } from 'child_process';

const CHUNK_SIZE = 4 * 1024; // 4KB
const CHUNKING_THRESHOLD = 16 * 1024; // 16KB

export function buildStdin(spec: { stdin?: string }): Buffer | null {
  if (!spec.stdin) return null;
  return Buffer.from(spec.stdin, 'utf-8');
}

export async function injectStdin(child: ChildProcess, payload: Buffer): Promise<void> {
  if (!child.stdin) return;

  if (payload.length <= CHUNKING_THRESHOLD) {
    child.stdin.write(payload);
    child.stdin.end();
    return;
  }

  // Chunked write for large payloads — yield between chunks to avoid blocking
  let offset = 0;
  while (offset < payload.length) {
    const chunk = payload.subarray(offset, offset + CHUNK_SIZE);
    child.stdin.write(chunk);
    offset += CHUNK_SIZE;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  child.stdin.end();
}
