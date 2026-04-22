import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { webhookOutAdapter } from '../index';
import { resetAllBuckets } from '../rate-limiter';
import { CancellationToken } from '../../../cancel/token';
import { EventBus } from '../../../events/bus';
import type { WebhookOutNodeSpec } from '@/lib/adpl/types/nodes/webhook-out';
import type { ExecutionContext, ExecutionOptions } from '../../types';
import type { WebhookSentEvent, WebhookRateLimitedEvent } from '../../../events/types';

// ─── Mock server ─────────────────────────────────────────────────────────────

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
    try { await currentHandler(req, res); }
    catch (err) { if (!res.headersSent) { res.writeHead(500); res.end(String(err)); } }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
        setHandler: (fn) => { currentHandler = fn; },
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

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeCtx(): ExecutionContext {
  return {
    $task: {
      id: 'webhook-task',
      pipelineVersionId: 'run-wh',
      prompt: '',
      tags: [],
      createdAt: '',
      pipelineMode: 'pipeline',
      projectId: 'proj-test',
      status: 'running',
      config: {},
    } as unknown as ExecutionContext['$task'],
    $project: {
      id: 'proj-test', name: 'test', path: '/tmp', description: null, createdAt: '',
    } as unknown as ExecutionContext['$project'],
    $trigger: {} as ExecutionContext['$trigger'],
    $env: {},
    $now: new Date(),
    $self: { id: 'wh-test' } as unknown as ExecutionContext['$self'],
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

function whSpec(url: string, overrides: Partial<WebhookOutNodeSpec> = {}): WebhookOutNodeSpec {
  return { id: 'wh-test', type: 'webhook_out', url, body: {}, ...overrides };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

let server: MockServer;
let baseUrl: string;

beforeAll(async () => {
  server = await startMockServer();
  baseUrl = server.baseUrl;
});

afterAll(async () => { await server.close(); });

beforeEach(() => { resetAllBuckets(); });

describe('webhookOutAdapter — Slack provider', () => {
  it('sends { text } payload for message shorthand', async () => {
    let received: Record<string, unknown> = {};
    server.setHandler(async (req, res) => {
      received = JSON.parse(await readBody(req));
      res.writeHead(200); res.end('ok');
    });

    const result = await webhookOutAdapter.execute(
      whSpec(`${baseUrl}/slack`, { provider: 'slack', body: { message: 'Hello Slack' } }),
      makeCtx(),
      makeOptions(),
    );

    expect(result.status).toBe('success');
    expect(received).toEqual({ text: 'Hello Slack' });
  });

  it('passes blocks through unchanged', async () => {
    let received: Record<string, unknown> = {};
    server.setHandler(async (req, res) => {
      received = JSON.parse(await readBody(req));
      res.writeHead(200); res.end('ok');
    });

    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: '*bold*' } }];
    await webhookOutAdapter.execute(
      whSpec(`${baseUrl}/slack-blocks`, { provider: 'slack', body: { blocks } }),
      makeCtx(),
      makeOptions(),
    );

    expect(received.blocks).toEqual(blocks);
  });
});

describe('webhookOutAdapter — Discord provider', () => {
  it('sends { content } payload for message shorthand', async () => {
    let received: Record<string, unknown> = {};
    server.setHandler(async (req, res) => {
      received = JSON.parse(await readBody(req));
      res.writeHead(204); res.end();
    });

    // 204 responses - server close without body
    server.setHandler(async (req, res) => {
      received = JSON.parse(await readBody(req));
      res.writeHead(200); res.end('');
    });

    await webhookOutAdapter.execute(
      whSpec(`${baseUrl}/discord`, { provider: 'discord', body: { message: 'Hello Discord' } }),
      makeCtx(),
      makeOptions(),
    );

    expect(received).toEqual({ content: 'Hello Discord' });
  });
});

describe('webhookOutAdapter — Teams provider', () => {
  it('sends { text } payload for message shorthand', async () => {
    let received: Record<string, unknown> = {};
    server.setHandler(async (req, res) => {
      received = JSON.parse(await readBody(req));
      res.writeHead(200); res.end('1');
    });

    await webhookOutAdapter.execute(
      whSpec(`${baseUrl}/teams`, { provider: 'teams', body: { message: 'Hello Teams' } }),
      makeCtx(),
      makeOptions(),
    );

    expect(received).toEqual({ text: 'Hello Teams' });
  });

  it('passes MessageCard through unchanged', async () => {
    let received: Record<string, unknown> = {};
    server.setHandler(async (req, res) => {
      received = JSON.parse(await readBody(req));
      res.writeHead(200); res.end('1');
    });

    const card = { '@type': 'MessageCard', text: 'Alert!', themeColor: 'FF0000' };
    await webhookOutAdapter.execute(
      whSpec(`${baseUrl}/teams-card`, { provider: 'teams', body: card }),
      makeCtx(),
      makeOptions(),
    );

    expect(received['@type']).toBe('MessageCard');
    expect(received.text).toBe('Alert!');
  });
});

describe('webhookOutAdapter — generic provider', () => {
  it('sends body as-is', async () => {
    let received: Record<string, unknown> = {};
    server.setHandler(async (req, res) => {
      received = JSON.parse(await readBody(req));
      res.writeHead(200); res.end('{}');
    });

    const body = { event: 'deploy', version: '1.2.3', success: true };
    await webhookOutAdapter.execute(
      whSpec(`${baseUrl}/generic`, { body }),
      makeCtx(),
      makeOptions(),
    );

    expect(received).toEqual(body);
  });
});

describe('webhookOutAdapter — webhook.sent event', () => {
  it('emits webhook.sent with provider and status', async () => {
    server.setHandler((_req, res) => { res.writeHead(200); res.end('{}'); });

    const bus = new EventBus();
    const sentEvents: WebhookSentEvent[] = [];
    bus.on('webhook.sent', (e) => { sentEvents.push(e as WebhookSentEvent); });

    await webhookOutAdapter.execute(
      whSpec(`${baseUrl}/event-test`, { provider: 'slack', body: { text: 'hi' } }),
      makeCtx(),
      makeOptions({ eventBus: bus }),
    );

    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].provider).toBe('slack');
    expect(sentEvents[0].status).toBe(200);
  });
});

describe('webhookOutAdapter — silentFail (default true)', () => {
  it('404 error returns success when silentFail=true (default)', async () => {
    server.setHandler((_req, res) => { res.writeHead(404); res.end('not found'); });

    const result = await webhookOutAdapter.execute(
      whSpec(`${baseUrl}/silent-fail`, { body: { msg: 'test' } }),
      makeCtx(),
      makeOptions(),
    );

    expect(result.status).toBe('success');
    const data = result.data as Record<string, unknown>;
    expect(data.delivered).toBe(false);
    expect(typeof data.error).toBe('string');
  });

  it('failOnError=true propagates failure', async () => {
    server.setHandler((_req, res) => { res.writeHead(500); res.end('error'); });

    const result = await webhookOutAdapter.execute(
      whSpec(`${baseUrl}/fail-on-error`, { body: { msg: 'test' }, silentFail: false, failOnError: true }),
      makeCtx(),
      makeOptions(),
    );

    expect(result.status).toBe('failure');
  });
});

describe('webhookOutAdapter — 429 retry via HTTP adapter', () => {
  it('retries on 429 (httpAdapter retry reuse)', async () => {
    let callCount = 0;
    server.setHandler((_req, res) => {
      callCount++;
      if (callCount === 1) {
        res.writeHead(429, { 'retry-after': '0' });
        res.end('rate limited');
      } else {
        res.writeHead(200); res.end('{}');
      }
    });

    const result = await webhookOutAdapter.execute(
      whSpec(`${baseUrl}/retry-429`, {
        provider: 'generic',
        body: { msg: 'test' },
        retryPolicy: { maxAttempts: 2 },
      }),
      makeCtx(),
      makeOptions(),
    );

    expect(result.status).toBe('success');
    expect(callCount).toBe(2);
  });
});

describe('webhookOutAdapter — rate limiter integration', () => {
  it('emits webhook.rate_limited when bucket exhausted', async () => {
    server.setHandler((_req, res) => { res.writeHead(200); res.end('{}'); });

    const bus = new EventBus();
    const rateLimitedEvents: WebhookRateLimitedEvent[] = [];
    bus.on('webhook.rate_limited', (e) => { rateLimitedEvents.push(e as WebhookRateLimitedEvent); });

    // Use high rpm (600/min) with slack: burst=5 will exhaust on 6th call
    const spec = whSpec(`${baseUrl}/rate-test`, {
      provider: 'slack',
      body: { text: 'test' },
      rateLimitPerMinute: 600,
    });

    for (let i = 0; i < 6; i++) {
      await webhookOutAdapter.execute(spec, makeCtx(), makeOptions({ eventBus: bus }));
    }

    expect(rateLimitedEvents.length).toBeGreaterThanOrEqual(1);
    expect(rateLimitedEvents[0].provider).toBe('slack');
  });
});

describe('webhookOutAdapter — defaultTimeout and validate', () => {
  it('defaultTimeout returns 30', () => {
    expect(webhookOutAdapter.defaultTimeout()).toBe(30);
  });

  it('validate always returns valid:true', () => {
    const result = webhookOutAdapter.validate(
      whSpec('https://hooks.slack.com/services/test', { provider: 'slack', body: {} }),
    );
    expect(result.valid).toBe(true);
  });
});
