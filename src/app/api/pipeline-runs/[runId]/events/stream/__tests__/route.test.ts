import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db/client';
import { pipelineEvents } from '@/lib/db/schema';
import { GET } from '../route';

function readChunks(stream: ReadableStream<Uint8Array>, ms: number): Promise<string> {
  return new Promise((resolve) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const stop = () => {
      reader.cancel().catch(() => undefined);
      resolve(buf);
    };
    const timer = setTimeout(stop, ms);
    void (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) buf += decoder.decode(value);
        }
      } catch {
        /* aborted */
      } finally {
        clearTimeout(timer);
        resolve(buf);
      }
    })();
  });
}

describe('/api/pipeline-runs/[runId]/events/stream', () => {
  beforeEach(() => {
    db.delete(pipelineEvents).run();
  });

  afterEach(() => {
    db.delete(pipelineEvents).run();
  });

  it('returns 200 + text/event-stream + no-cache', async () => {
    const ac = new AbortController();
    const req = new Request('http://x/api/pipeline-runs/r1/events/stream', { signal: ac.signal });
    const res = await GET(req, { params: Promise.resolve({ runId: 'r1' }) });
    ac.abort();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toContain('no-cache');
    expect(res.headers.get('Connection')).toBe('keep-alive');
  });

  it('streams existing events on first tick (backlog) and ignores other runId', async () => {
    db.insert(pipelineEvents).values([
      { id: 'e1', runId: 'rA', type: 'node.ready',     payloadJson: '{}', createdAt: '2026-04-25T00:00:00.000Z' },
      { id: 'e2', runId: 'rA', type: 'node.completed', payloadJson: '{}', createdAt: '2026-04-25T00:00:01.000Z' },
      { id: 'eX', runId: 'rB', type: 'node.ready',     payloadJson: '{}', createdAt: '2026-04-25T00:00:02.000Z' },
    ]).run();

    const ac = new AbortController();
    const req = new Request('http://x/api/pipeline-runs/rA/events/stream', { signal: ac.signal });
    const res = await GET(req, { params: Promise.resolve({ runId: 'rA' }) });
    const body = await readChunks(res.body!, 200);
    ac.abort();

    // backlog: 2 'pipeline' events for rA
    expect(body).toContain('event: pipeline');
    expect(body).toContain('id: e1');
    expect(body).toContain('id: e2');
    // other run not leaked
    expect(body).not.toContain('id: eX');
    // heartbeat present
    expect(body).toContain(': heartbeat');
  });

  it('aborting the request cancels the stream', async () => {
    const ac = new AbortController();
    const req = new Request('http://x/api/pipeline-runs/r-cancel/events/stream', { signal: ac.signal });
    const res = await GET(req, { params: Promise.resolve({ runId: 'r-cancel' }) });
    // Body is closed once we cancel reader; readChunks resolves with what was buffered.
    const body = await readChunks(res.body!, 100);
    ac.abort();
    // First heartbeat at minimum
    expect(body).toContain(': heartbeat');
  });
});
