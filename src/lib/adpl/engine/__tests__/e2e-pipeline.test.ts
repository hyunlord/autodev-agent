import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

// ── C9-1 facade 시나리오용 DB mock (기존 테스트는 이 모듈 미사용 → 무영향) ──
const facadeMocks = vi.hoisted(() => ({
  dbGet: vi.fn(),
  dbRun: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ get: facadeMocks.dbGet }) }) }),
    insert: () => ({ values: () => ({ run: facadeMocks.dbRun }) }),
    update: () => ({ set: () => ({ where: () => ({ run: facadeMocks.dbRun }) }) }),
  },
}));
vi.mock('@/lib/db/schema', () => ({ tasks: {}, events: {}, pipelineVersions: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
vi.mock('nanoid', () => ({ nanoid: () => 'facade-e2e-id' }));
vi.mock('@/worker/pipeline', () => ({ runLegacyPipeline: vi.fn() }));
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { PipelineExecutor } from '../executor';
import { PipelineCompiler } from '../compiler';
import { StateStore } from '../state/store';
import { EventBus } from '../events/bus';
import { AdapterRegistry } from '../adapters/registry';
import { MockAdapter } from '../adapters/mock';
import { shellAdapter } from '../adapters/shell';
import { httpAdapter } from '../adapters/http';
import { webhookOutAdapter } from '../adapters/webhook-out';
import type { ShellOutputEvent } from '../events/types';

const NON_SHELL_TYPES = [
  'agent', 'http', 'webhook_out',
  'branch', 'parallel', 'loop', 'gate',
  'mcp', 'set', 'transform',
];

const TRIGGER = {
  triggerId: 'tr1',
  type: 'task_created' as const,
  firedAt: '2026-04-20T00:00:00.000Z',
};

function makeExecutor(bus?: EventBus) {
  const registry = new AdapterRegistry();
  const eventBus = bus ?? new EventBus();
  registry.register(shellAdapter);
  for (const t of NON_SHELL_TYPES) {
    registry.register(new MockAdapter({ type: t }));
  }
  const executor = new PipelineExecutor(new PipelineCompiler(), registry, new StateStore(), eventBus);
  return { executor, eventBus };
}

describe('Stage 3 E2E — Shell adapter in pipeline', () => {
  let executor: PipelineExecutor;

  beforeEach(() => {
    const e = makeExecutor();
    executor = e.executor;
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 10: Shell node echoes and returns JSON output
  // ─────────────────────────────────────────────────────
  it('10. Shell node executes echo and parses text output', async () => {
    const yaml = `
adplVersion: 1
name: shell-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: run-echo
    type: shell
    command: "echo pipeline-hello"
    outputFormat: text
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-shell',
      pipelineVersionId: 'shell-e2e-v1',
      taskId: 'e2e-shell-task',
      triggerContext: TRIGGER,
      worktreeRoot: process.cwd(),
    });

    expect(result.status).toBe('completed');
    expect(result.completedNodes).toBe(1);
    expect(result.failedNodes).toBe(0);

    // state is keyed by pathId ('pipeline.0'), not userId — grab the single node
    const [nodeState] = Array.from(result.state.nodes.values());
    expect(nodeState?.status).toBe('success');
    expect((nodeState?.output?.data as Record<string, unknown>)?.exitCode).toBe(0);
    const stdout = String((nodeState?.output?.data as Record<string, unknown>)?.stdout ?? '');
    expect(stdout).toContain('pipeline-hello');
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 11: Shell node with JSON output is parsed automatically
  // ─────────────────────────────────────────────────────
  it('11. Shell node with JSON stdout is parsed in auto mode', async () => {
    const yamlFixed = `
adplVersion: 1
name: shell-json
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: json-node
    type: shell
    command: "node -e \\"console.log(JSON.stringify({status:'ok',count:3}))\\""
    outputFormat: auto
`;

    const result = await executor.run({
      pipelineYaml: yamlFixed,
      projectId: 'e2e-shell',
      pipelineVersionId: 'shell-json-v1',
      taskId: 'e2e-json-task',
      triggerContext: TRIGGER,
      worktreeRoot: process.cwd(),
    });

    expect(result.status).toBe('completed');
    const [nodeState] = Array.from(result.state.nodes.values());
    expect(nodeState?.status).toBe('success');
    const data = nodeState?.output?.data as Record<string, unknown>;
    expect(typeof data?.stdout).toBe('object');
    expect((data?.stdout as Record<string, unknown>)?.count).toBe(3);
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 12: Shell node failure propagates as pipeline failure
  // ─────────────────────────────────────────────────────
  it('12. Failing shell command causes pipeline failure', async () => {
    const yaml = `
adplVersion: 1
name: shell-fail
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: fail-node
    type: shell
    command: "node -e \\"process.exit(1)\\""
settings:
  onError: abort
`;

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-shell',
      pipelineVersionId: 'shell-fail-v1',
      taskId: 'e2e-fail-task',
      triggerContext: TRIGGER,
      worktreeRoot: process.cwd(),
    });

    expect(result.status).toBe('failed');
    expect(result.failedNodes).toBe(1);
  });

  // ─────────────────────────────────────────────────────
  // 시나리오 13: shell.output events emitted during pipeline run
  // ─────────────────────────────────────────────────────
  it('13. shell.output events are emitted during pipeline execution', async () => {
    const collected: ShellOutputEvent[] = [];
    const { executor: exec, eventBus } = makeExecutor();
    eventBus.on('shell.output', (e) => { collected.push(e as ShellOutputEvent); });

    const yaml = `
adplVersion: 1
name: shell-events
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: evt-node
    type: shell
    command: "echo event-test"
`;

    await exec.run({
      pipelineYaml: yaml,
      projectId: 'e2e-shell',
      pipelineVersionId: 'shell-events-v1',
      taskId: 'e2e-events-task',
      triggerContext: TRIGGER,
      worktreeRoot: process.cwd(),
    });

    expect(collected.length).toBeGreaterThan(0);
    expect(collected.some((e) => e.type === 'shell.output')).toBe(true);
    expect(collected.some((e) => e.chunk.includes('event-test'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────
// Scenario 14: HTTP node in pipeline (real httpAdapter + mock server)
// ─────────────────────────────────────────────────────

let httpServerUrl = '';
let httpServerClose: () => Promise<void>;

beforeAll(async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ pipelineOk: true }));
  });
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      httpServerUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  httpServerClose = () =>
    new Promise((res, rej) => server.close((err) => (err ? rej(err) : res())));
});

afterAll(async () => {
  await httpServerClose?.();
});

describe('Stage 3 E2E — HTTP adapter in pipeline', () => {
  it('14. HTTP node fetches JSON and pipeline completes successfully', async () => {
    const yaml = `
adplVersion: 1
name: http-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: http-call
    type: http
    url: "${httpServerUrl}/data"
    method: GET
    allowedHosts:
      - "127.0.0.1"
`;

    const registry = new AdapterRegistry();
    registry.register(httpAdapter);
    for (const t of NON_SHELL_TYPES.filter((t) => t !== 'http')) {
      registry.register(new MockAdapter({ type: t }));
    }
    const executor = new PipelineExecutor(
      new PipelineCompiler(),
      registry,
      new StateStore(),
      new EventBus(),
    );

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-http',
      pipelineVersionId: 'http-e2e-v1',
      taskId: 'e2e-http-task',
      triggerContext: TRIGGER,
      worktreeRoot: process.cwd(),
    });

    expect(result.status).toBe('completed');
    expect(result.completedNodes).toBe(1);
    expect(result.failedNodes).toBe(0);

    const [nodeState] = Array.from(result.state.nodes.values());
    expect(nodeState?.status).toBe('success');
    const data = nodeState?.output?.data as Record<string, unknown>;
    expect(data?.status).toBe(200);
    expect((data?.bodyJson as Record<string, unknown>)?.pipelineOk).toBe(true);
  });
});

// ─────────────────────────────────────────────────────
// Scenario 15: webhook_out node in pipeline (real webhookOutAdapter + mock server)
// ─────────────────────────────────────────────────────

let webhookServerUrl = '';
let webhookServerClose: () => Promise<void>;
let lastWebhookBody: Record<string, unknown> = {};

beforeAll(async () => {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try { lastWebhookBody = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* ignore */ }
      res.writeHead(200); res.end('ok');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      webhookServerUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  webhookServerClose = () =>
    new Promise((res, rej) => server.close((err) => (err ? rej(err) : res())));
});

afterAll(async () => { await webhookServerClose?.(); });

// ─────────────────────────────────────────────────────
// Stage 3 C9-1: Facade 경유 Phase P 실행 시나리오
// DB mock + PipelineExecutor.prototype.run spy로 경로 검증
// ─────────────────────────────────────────────────────

import { runPipeline } from '@/worker/pipeline-facade';

const FACADE_YAML = `
adplVersion: 1
name: facade-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: plan
    type: agent
    role: planner
`;

describe('Stage 3 C9-1 — facade routes phase_p task to PipelineExecutor', () => {
  let runSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    facadeMocks.dbGet.mockReset();
    facadeMocks.dbRun.mockReset();
    runSpy = vi.spyOn(PipelineExecutor.prototype, 'run').mockResolvedValue({
      runId: 'run-1',
      pipelineVersionId: 'v1',
      status: 'completed',
      completedNodes: 1,
      failedNodes: 0,
      skippedNodes: 0,
      cancelledNodes: 0,
      totalDurationMs: 10,
      compileDurationMs: 5,
      executionDurationMs: 5,
      state: {} as never,
      plan: {} as never,
    });
  });

  afterEach(() => {
    runSpy.mockRestore();
  });

  it('16. facade.runPipeline(phase_p) → PipelineExecutor.run receives correct RunInput', async () => {
    facadeMocks.dbGet
      .mockReturnValueOnce({
        id: 'task-1',
        pipelineMode: 'phase_p',
        pipelineVersionId: 'v1',
        projectId: 'proj-1',
        projectDir: '/tmp/facade-e2e',
        status: 'pending',
        updatedAt: new Date().toISOString(),
      })
      .mockReturnValueOnce({ id: 'v1', pipelineYaml: FACADE_YAML });

    const emits: Array<{ type: string; success?: boolean }> = [];
    await runPipeline('task-1', (e) => emits.push(e as { type: string; success?: boolean }));

    expect(runSpy).toHaveBeenCalledOnce();
    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineYaml: FACADE_YAML,
        taskId: 'task-1',
        projectId: 'proj-1',
        pipelineVersionId: 'v1',
        worktreeRoot: '/tmp/facade-e2e',
      }),
    );
    expect(emits.some((e) => e.type === 'task_complete' && e.success === true)).toBe(true);
  });
});

describe('Stage 3 E2E — webhook_out adapter in pipeline', () => {
  it('15. webhook_out node sends Slack payload and pipeline completes', async () => {
    const yaml = `
adplVersion: 1
name: webhook-e2e
triggers:
  - id: t1
    type: task_created
pipeline:
  - id: notify
    type: webhook_out
    provider: slack
    url: "${webhookServerUrl}/webhook"
    body:
      message: "pipeline complete"
`;

    const registry = new AdapterRegistry();
    registry.register(webhookOutAdapter);
    for (const t of NON_SHELL_TYPES.filter((t) => t !== 'webhook_out')) {
      registry.register(new MockAdapter({ type: t }));
    }
    const executor = new PipelineExecutor(
      new PipelineCompiler(),
      registry,
      new StateStore(),
      new EventBus(),
    );

    const result = await executor.run({
      pipelineYaml: yaml,
      projectId: 'e2e-webhook',
      pipelineVersionId: 'webhook-e2e-v1',
      taskId: 'e2e-webhook-task',
      triggerContext: TRIGGER,
      worktreeRoot: process.cwd(),
    });

    expect(result.status).toBe('completed');
    expect(result.completedNodes).toBe(1);
    expect(result.failedNodes).toBe(0);

    const [nodeState] = Array.from(result.state.nodes.values());
    expect(nodeState?.status).toBe('success');
    // Slack transforms { message: ... } → { text: ... }
    expect(lastWebhookBody).toEqual({ text: 'pipeline complete' });
  });
});
