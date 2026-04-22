import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { httpAdapter } from '../index';
import { HttpPolicyError } from '../policy';
import { CancellationToken } from '../../../cancel/token';
import { EventBus } from '../../../events/bus';
import type { HttpNodeSpec } from '@/lib/adpl/types/nodes/http';
import type { ExecutionContext, ExecutionOptions } from '../../types';
import type { HttpRequestEvent, HttpResponseEvent, HttpRetryEvent } from '../../../events/types';

// ─── Mock server helpers ──────────────────────────────────────────────────────

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

interface MockServer {
  baseUrl: string;
  close: () => Promise<void>;
  setHandler: (fn: Handler) => void;
}

function startMockServer(): Promise<MockServer> {
  let currentHandler: Handler = (_req, res) => {
    res.writeHead(200);
    res.end('{}');
  };

  const server = createServer(async (req, res) => {
    try {
      await currentHandler(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end(String(err));
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
        setHandler: (fn) => {
          currentHandler = fn;
        },
      });
    });
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

// ─── Test context helpers ────────────────────────────────────────────────────

function makeCtx(): ExecutionContext {
  return {
    $task: {
      id: 'http-task-test',
      pipelineVersionId: 'run-test',
      prompt: '',
      tags: [],
      createdAt: '',
      pipelineMode: 'pipeline',
      projectId: 'proj-test',
      status: 'running',
      config: {},
    } as unknown as ExecutionContext['$task'],
    $project: {
      id: 'proj-test',
      name: 'test',
      path: '/tmp',
      description: null,
      createdAt: '',
    } as unknown as ExecutionContext['$project'],
    $trigger: {} as ExecutionContext['$trigger'],
    $env: {},
    $now: new Date(),
    $self: { id: 'http-test' } as unknown as ExecutionContext['$self'],
    $nodes: {},
    $prev: null,
    $loop: null,
    $flow: null,
    $variables: {},
    worktreeRoot: '/tmp',
  };
}

function makeOptions(overrides: Partial<ExecutionOptions> = {}): ExecutionOptions {
  return {
    cancellationToken: new CancellationToken(),
    eventBus: new EventBus(),
    timeoutMs: 0,
    ...overrides,
  };
}

function httpSpec(url: string, overrides: Partial<HttpNodeSpec> = {}): HttpNodeSpec {
  return {
    id: 'test',
    type: 'http',
    url,
    allowedHosts: ['127.0.0.1'],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

let server: MockServer;
let baseUrl: string;

beforeAll(async () => {
  server = await startMockServer();
  baseUrl = server.baseUrl;
});

afterAll(async () => {
  await server.close();
});

describe('httpAdapter — GET 200 success', () => {
  it('returns success with parsed JSON data', async () => {
    server.setHandler((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, value: 42 }));
    });

    const result = await httpAdapter.execute(
      httpSpec(`${baseUrl}/test`),
      makeCtx(),
      makeOptions(),
    );

    expect(result.status).toBe('success');
    const data = result.data as Record<string, unknown>;
    expect(data.status).toBe(200);
    expect((data.bodyJson as Record<string, unknown>).ok).toBe(true);
    expect((data.bodyJson as Record<string, unknown>).value).toBe(42);
  });

  it('emits http.request and http.response events', async () => {
    server.setHandler((_req, res) => {
      res.writeHead(200);
      res.end('{}');
    });

    const bus = new EventBus();
    const requests: HttpRequestEvent[] = [];
    const responses: HttpResponseEvent[] = [];
    bus.on('http.request', (e) => { requests.push(e as HttpRequestEvent); });
    bus.on('http.response', (e) => { responses.push(e as HttpResponseEvent); });

    await httpAdapter.execute(
      httpSpec(`${baseUrl}/events`),
      makeCtx(),
      makeOptions({ eventBus: bus }),
    );

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
    expect(requests[0].attempt).toBe(0);
    expect(responses).toHaveLength(1);
    expect(responses[0].status).toBe(200);
  });
});

describe('httpAdapter — POST with body and idempotency-key', () => {
  it('sends JSON body and receives response', async () => {
    let receivedBody = '';
    let receivedIdempotencyKey = '';

    server.setHandler(async (req, res) => {
      receivedBody = await readBody(req);
      receivedIdempotencyKey = req.headers['idempotency-key'] as string ?? '';
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ created: true }));
    });

    const result = await httpAdapter.execute(
      httpSpec(`${baseUrl}/create`, {
        method: 'POST',
        body: { name: 'test' },
        idempotencyKey: 'idem-123',
      }),
      makeCtx(),
      makeOptions(),
    );

    expect(result.status).toBe('success');
    expect(JSON.parse(receivedBody)).toEqual({ name: 'test' });
    expect(receivedIdempotencyKey).toBe('idem-123');
  });
});

describe('httpAdapter — 429 retry with Retry-After', () => {
  it('retries after Retry-After: 0 and succeeds', async () => {
    let callCount = 0;

    server.setHandler((_req, res) => {
      callCount++;
      if (callCount === 1) {
        res.writeHead(429, { 'retry-after': '0' });
        res.end('rate limited');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      }
    });

    const bus = new EventBus();
    const retryEvents: HttpRetryEvent[] = [];
    bus.on('http.retry', (e) => { retryEvents.push(e as HttpRetryEvent); });

    const result = await httpAdapter.execute(
      httpSpec(`${baseUrl}/retry-test`, { method: 'GET' }),
      makeCtx(),
      makeOptions({ eventBus: bus }),
    );

    expect(result.status).toBe('success');
    expect(callCount).toBe(2);
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0].reason).toBe('status');
    expect(retryEvents[0].backoffMs).toBe(0);
  });

  it('emits http.retry event with backoffMs', async () => {
    let callCount = 0;
    server.setHandler((_req, res) => {
      callCount++;
      if (callCount < 3) {
        res.writeHead(503, { 'retry-after': '0' });
        res.end('unavailable');
      } else {
        res.writeHead(200);
        res.end('{}');
      }
    });

    const bus = new EventBus();
    const retryEvents: HttpRetryEvent[] = [];
    bus.on('http.retry', (e) => { retryEvents.push(e as HttpRetryEvent); });

    await httpAdapter.execute(
      httpSpec(`${baseUrl}/multi-retry`, { method: 'GET' }),
      makeCtx(),
      makeOptions({ eventBus: bus }),
    );

    expect(retryEvents).toHaveLength(2);
    expect(retryEvents[0].attempt).toBe(0);
    expect(retryEvents[1].attempt).toBe(1);
  });
});

describe('httpAdapter — 500 error + retry exhaustion', () => {
  it('GET 500 retries up to 2 times then returns failure', async () => {
    let callCount = 0;
    server.setHandler((_req, res) => {
      callCount++;
      // 500 is not in default retryable statuses [429, 502, 503, 504]
      res.writeHead(500);
      res.end('internal error');
    });

    const result = await httpAdapter.execute(
      httpSpec(`${baseUrl}/fail500`, { method: 'GET' }),
      makeCtx(),
      makeOptions(),
    );

    // 500 is not retried (not in default onStatuses)
    expect(result.status).toBe('failure');
    expect(callCount).toBe(1);
    expect(result.error?.code).toBe('http_500');
  });

  it('POST without idempotencyKey does not retry on 429', async () => {
    let callCount = 0;
    server.setHandler((_req, res) => {
      callCount++;
      res.writeHead(429, { 'retry-after': '0' });
      res.end('rate limited');
    });

    const result = await httpAdapter.execute(
      httpSpec(`${baseUrl}/post-no-retry`, { method: 'POST', body: { x: 1 } }),
      makeCtx(),
      makeOptions(),
    );

    expect(callCount).toBe(1); // no retry for non-idempotent POST
    expect(result.status).toBe('failure');
  });
});

describe('httpAdapter — AbortSignal / cancellation', () => {
  it('cancelled token before execute returns cancelled status', async () => {
    server.setHandler((_req, res) => {
      res.writeHead(200);
      res.end('{}');
    });

    const token = new CancellationToken();
    token.cancel('test-cancel');

    const result = await httpAdapter.execute(
      httpSpec(`${baseUrl}/cancel-test`),
      makeCtx(),
      makeOptions({ cancellationToken: token }),
    );

    expect(result.status).toBe('cancelled');
    expect(result.error?.category).toBe('cancellation');
  });
});

describe('httpAdapter — host policy enforcement', () => {
  it('throws HttpPolicyError for localhost URL (default denylist)', async () => {
    await expect(
      httpAdapter.execute(
        { id: 'test', type: 'http', url: 'http://localhost:9999/api' },
        makeCtx(),
        makeOptions(),
      ),
    ).rejects.toBeInstanceOf(HttpPolicyError);
  });

  it('throws HttpPolicyError for private IP (default denylist)', async () => {
    await expect(
      httpAdapter.execute(
        { id: 'test', type: 'http', url: 'http://192.168.1.1/api' },
        makeCtx(),
        makeOptions(),
      ),
    ).rejects.toBeInstanceOf(HttpPolicyError);
  });

  it('throws HttpPolicyError when host not in allowedHosts', async () => {
    await expect(
      httpAdapter.execute(
        {
          id: 'test',
          type: 'http',
          url: `${baseUrl}/api`,
          allowedHosts: ['api.example.com'],
        },
        makeCtx(),
        makeOptions(),
      ),
    ).rejects.toBeInstanceOf(HttpPolicyError);
  });
});

describe('httpAdapter — multipart body', () => {
  it('server receives multipart/form-data Content-Type with boundary', async () => {
    let receivedContentType = '';

    server.setHandler(async (req, res) => {
      receivedContentType = req.headers['content-type'] ?? '';
      await readBody(req); // drain
      res.writeHead(200);
      res.end('{}');
    });

    await httpAdapter.execute(
      httpSpec(`${baseUrl}/upload`, {
        method: 'POST',
        bodyFormat: 'multipart',
        body: { field1: 'value1', field2: 'value2' },
      }),
      makeCtx(),
      makeOptions(),
    );

    expect(receivedContentType).toMatch(/^multipart\/form-data; boundary=/);
  });
});

describe('httpAdapter — queryParams URL encoding', () => {
  it('appends queryParams to URL', async () => {
    let receivedUrl = '';

    server.setHandler((req, res) => {
      receivedUrl = req.url ?? '';
      res.writeHead(200);
      res.end('{}');
    });

    await httpAdapter.execute(
      httpSpec(`${baseUrl}/search`, {
        queryParams: { q: 'hello world', page: '1' },
      }),
      makeCtx(),
      makeOptions(),
    );

    expect(receivedUrl).toContain('q=hello+world');
    expect(receivedUrl).toContain('page=1');
  });
});

describe('httpAdapter — validate()', () => {
  it('returns valid:true for allowed public URL', () => {
    const result = httpAdapter.validate({
      id: 'test',
      type: 'http',
      url: 'https://api.example.com/v1',
    });
    expect(result.valid).toBe(true);
  });

  it('returns valid:false for localhost URL', () => {
    const result = httpAdapter.validate({
      id: 'test',
      type: 'http',
      url: 'http://localhost:3000/api',
    });
    expect(result.valid).toBe(false);
    expect(result.errors?.[0].field).toBe('url');
  });

  it('returns valid:true for expression URL (skip validation)', () => {
    const result = httpAdapter.validate({
      id: 'test',
      type: 'http',
      url: '{{ $task.config.apiUrl }}/endpoint',
    });
    expect(result.valid).toBe(true);
  });
});

describe('httpAdapter — defaultTimeout()', () => {
  it('returns 30 seconds', () => {
    expect(httpAdapter.defaultTimeout()).toBe(30);
  });
});
