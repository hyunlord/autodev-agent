import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PipelineCompiler } from '../index';
import { CompileCache } from '../cache';

function yamlFromFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8');
}

// ─── Success ──────────────────────────────────────────────────────────────────

describe('PipelineCompiler — success', () => {
  it('01-hello-world: ok=true, 1 node, id/compiledAt populated', async () => {
    const compiler = new PipelineCompiler();
    const result = await compiler.compile(yamlFromFile('examples/adpl/01-hello-world.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.nodes.size).toBe(1);
    expect(result.plan.topologicalOrder).toHaveLength(1);
    expect(result.plan.pipelineName).toBe('hello-world');
    expect(result.plan.id).toBeTruthy();
    expect(result.plan.compiledAt).toBeGreaterThan(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('02-plan-code-verify: topological order plan→code→verify, prerequisites wired', async () => {
    const compiler = new PipelineCompiler();
    const result = await compiler.compile(yamlFromFile('examples/adpl/02-plan-code-verify.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const order = result.plan.topologicalOrder;
    expect(order.indexOf('pipeline.0')).toBeLessThan(order.indexOf('pipeline.1'));
    expect(order.indexOf('pipeline.1')).toBeLessThan(order.indexOf('pipeline.2'));
    const code = result.plan.nodes.get('pipeline.1')!;
    expect(code.prerequisites).toContain('pipeline.0');
    const verify = result.plan.nodes.get('pipeline.2')!;
    expect(verify.prerequisites).toContain('pipeline.1');
  });

  it('03-parallel-checks: all branch nodes included, topo order = nodes count', async () => {
    const compiler = new PipelineCompiler();
    const result = await compiler.compile(yamlFromFile('examples/adpl/03-parallel-checks.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.nodes.size).toBeGreaterThan(3);
    expect(result.plan.topologicalOrder.length).toBe(result.plan.nodes.size);
  });

  it('context defaults: maxParallel=5, totalTimeout=7200, nodeTimeout=600, allowedEnvKeys=[]', async () => {
    const compiler = new PipelineCompiler();
    const result = await compiler.compile(`
adplVersion: 1
name: no-settings
pipeline:
  - id: only
    type: agent
    role: planner
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = result.plan.context.settings;
    expect(ctx.maxParallel).toBe(5);
    expect(ctx.totalTimeout).toBe(7200);
    expect(ctx.nodeTimeout).toBe(600);
    expect(ctx.allowedEnvKeys).toEqual([]);
  });

  it('all 10 samples: ok=true, nodes>0, topo order = nodes.size', async () => {
    const compiler = new PipelineCompiler();
    const samples = [
      'examples/adpl/01-hello-world.yaml',
      'examples/adpl/02-plan-code-verify.yaml',
      'examples/adpl/03-parallel-checks.yaml',
      'examples/adpl/04-branch-by-tags.yaml',
      'examples/adpl/05-loop-foreach.yaml',
      'examples/adpl/06-gate-approval.yaml',
      'examples/adpl/07-schedule-daily.yaml',
      'examples/adpl/08-webhook-pr.yaml',
      'examples/adpl/09-mcp-linear.yaml',
      'examples/adpl/10-complex-ci.yaml',
    ];
    for (const sample of samples) {
      const result = await compiler.compile(yamlFromFile(sample));
      expect(result.ok, `${sample} should succeed`).toBe(true);
      if (!result.ok) continue;
      expect(result.plan.nodes.size, `${sample} nodes > 0`).toBeGreaterThan(0);
      expect(result.plan.topologicalOrder.length, `${sample} topo = nodes`).toBe(
        result.plan.nodes.size,
      );
    }
  });
});

// ─── Failure ──────────────────────────────────────────────────────────────────

describe('PipelineCompiler — failure', () => {
  it('invalid YAML syntax: ok=false, code=parse_error', async () => {
    const compiler = new PipelineCompiler();
    const result = await compiler.compile('{ invalid: yaml: ::: syntax');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('parse_error');
  });

  it('schema error (missing name field): ok=false, code=parse_error', async () => {
    const compiler = new PipelineCompiler();
    const result = await compiler.compile(`
adplVersion: 1
pipeline:
  - id: only
    type: agent
    role: planner
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('parse_error');
  });

  it('forward_reference: ok=false, errors contain forward_reference', async () => {
    const compiler = new PipelineCompiler();
    const result = await compiler.compile(`
adplVersion: 1
name: fwd-ref-test
pipeline:
  - id: early
    type: agent
    role: custom
    prompt: "$nodes.later.output"
  - id: later
    type: agent
    role: planner
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === 'forward_reference')).toBe(true);
    const err = result.errors.find((e) => e.code === 'forward_reference')!;
    expect(err.pathId).toBe('pipeline.0');
    expect(err.message).toContain('later');
  });

  it('unknown_target: ok=false, errors contain unknown_target', async () => {
    const compiler = new PipelineCompiler();
    const result = await compiler.compile(`
adplVersion: 1
name: unknown-target-test
pipeline:
  - id: only
    type: agent
    role: custom
    prompt: "$nodes.ghost.output"
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === 'unknown_target')).toBe(true);
    const err = result.errors.find((e) => e.code === 'unknown_target')!;
    expect(err.message).toContain('ghost');
  });

  it('parallel_sibling: ok=false, errors contain parallel_sibling', async () => {
    const compiler = new PipelineCompiler();
    const result = await compiler.compile(`
adplVersion: 1
name: parallel-sibling-test
pipeline:
  - id: checks
    type: parallel
    mergeStrategy: all_must_pass
    branches:
      - id: lint
        nodes:
          - id: lint-cmd
            type: shell
            command: "pnpm lint"
      - id: test
        nodes:
          - id: test-cmd
            type: shell
            command: "echo $nodes.lint-cmd.output"
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === 'parallel_sibling')).toBe(true);
  });
});

// ─── Cache ────────────────────────────────────────────────────────────────────

describe('CompileCache', () => {
  it('second compile() returns cached plan (same id)', async () => {
    const cache = new CompileCache();
    const compiler = new PipelineCompiler(cache);
    const yaml = yamlFromFile('examples/adpl/01-hello-world.yaml');
    const r1 = await compiler.compile(yaml);
    const r2 = await compiler.compile(yaml);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r2.plan.id).toBe(r1.plan.id);
  });

  it('different YAML produces different plans (different ids)', async () => {
    const compiler = new PipelineCompiler();
    const r1 = await compiler.compile(yamlFromFile('examples/adpl/01-hello-world.yaml'));
    const r2 = await compiler.compile(yamlFromFile('examples/adpl/02-plan-code-verify.yaml'));
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.plan.id).not.toBe(r2.plan.id);
  });

  it('cache.get returns null after TTL expires', () => {
    const cache = new CompileCache();
    const now = Date.now();
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(now) // set() — expiresAt = now + TTL
      .mockReturnValueOnce(now + 10 * 60 * 1000 + 1); // get() — 1ms past expiry

    const fakePlan = { id: 'fake' } as never;
    cache.set('k', fakePlan);
    expect(cache.get('k')).toBeNull();

    vi.restoreAllMocks();
  });
});
