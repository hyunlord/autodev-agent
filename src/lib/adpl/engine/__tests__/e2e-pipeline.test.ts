import { describe, it, expect, beforeEach } from 'vitest';
import { PipelineExecutor } from '../executor';
import { PipelineCompiler } from '../compiler';
import { StateStore } from '../state/store';
import { EventBus } from '../events/bus';
import { AdapterRegistry } from '../adapters/registry';
import { MockAdapter } from '../adapters/mock';
import { shellAdapter } from '../adapters/shell';
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
