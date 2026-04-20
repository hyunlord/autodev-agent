import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseYaml } from '../yaml-parser';
import { extractFlat } from '../flat-extractor';
import { resolveReferences } from '../ref-resolver';
import { buildAdjacency } from '../adjacency';

async function buildFromFile(relativePath: string) {
  const yaml = readFileSync(join(process.cwd(), relativePath), 'utf-8');
  const parsed = await parseYaml({ yaml, sourcePath: relativePath });
  const extraction = extractFlat(parsed);
  const resolved = resolveReferences(extraction);
  return buildAdjacency(extraction, resolved);
}

async function buildFromYaml(yaml: string) {
  const parsed = await parseYaml({ yaml });
  const extraction = extractFlat(parsed);
  const resolved = resolveReferences(extraction);
  return buildAdjacency(extraction, resolved);
}

describe('buildAdjacency', () => {
  it('single node: no edges', async () => {
    const graph = await buildFromFile('examples/adpl/01-hello-world.yaml');
    expect(graph.allNodes).toHaveLength(1);
    const id = graph.allNodes[0];
    expect(graph.forward.get(id)!.size).toBe(0);
    expect(graph.reverse.get(id)!.size).toBe(0);
  });

  it('sequential chain: plan → code → verify', async () => {
    const graph = await buildFromFile('examples/adpl/02-plan-code-verify.yaml');
    expect(graph.forward.get('pipeline.0')!.has('pipeline.1')).toBe(true);
    expect(graph.forward.get('pipeline.1')!.has('pipeline.2')).toBe(true);
    expect(graph.reverse.get('pipeline.0')!.size).toBe(0);
  });

  it('reference edge deduped with sequential edge', async () => {
    // code references plan AND is sequentially after plan — same edge, deduplicated
    const graph = await buildFromFile('examples/adpl/02-plan-code-verify.yaml');
    expect(graph.reverse.get('pipeline.1')!.size).toBe(1);
    expect(graph.reverse.get('pipeline.1')!.has('pipeline.0')).toBe(true);
  });

  it('reference adds distinct non-sequential edge', async () => {
    // c references a (skipping b) — ref edge is distinct from sequential
    const graph = await buildFromYaml(`
adplVersion: 1
name: ref-edge-test
pipeline:
  - id: a
    type: agent
    role: planner
  - id: b
    type: agent
    role: coder
  - id: c
    type: agent
    role: custom
    prompt: "$nodes.a.output"
`);
    // sequential: a→b, b→c; reference: a→c
    expect(graph.forward.get('pipeline.0')!.has('pipeline.1')).toBe(true); // a→b sequential
    expect(graph.forward.get('pipeline.0')!.has('pipeline.2')).toBe(true); // a→c reference
    expect(graph.reverse.get('pipeline.2')!.has('pipeline.0')).toBe(true); // c prereq: a
    expect(graph.reverse.get('pipeline.2')!.has('pipeline.1')).toBe(true); // c prereq: b
  });

  it('parallel branches: first node prereq = parallel node (all branches independent)', async () => {
    const graph = await buildFromFile('examples/adpl/03-parallel-checks.yaml');
    // checks (pipeline.0) is prereq for all branch-first nodes
    expect(graph.forward.get('pipeline.0')!.has('pipeline.0.branches.0.nodes.0')).toBe(true);
    expect(graph.forward.get('pipeline.0')!.has('pipeline.0.branches.1.nodes.0')).toBe(true);
    expect(graph.forward.get('pipeline.0')!.has('pipeline.0.branches.2.nodes.0')).toBe(true);
    // branches are independent — no cross-branch edges
    expect(
      graph.forward.get('pipeline.0.branches.0.nodes.0')!.has('pipeline.0.branches.1.nodes.0'),
    ).toBe(false);
  });

  it('branch cases: first-in-case prereq = branch node, no cross-case edges', async () => {
    const graph = await buildFromFile('examples/adpl/04-branch-by-tags.yaml');
    const case0 = 'pipeline.2.cases.0.then.0';
    const case1 = 'pipeline.2.cases.1.then.0';
    // both depend on route (pipeline.2)
    expect(graph.reverse.get(case0)!.has('pipeline.2')).toBe(true);
    expect(graph.reverse.get(case1)!.has('pipeline.2')).toBe(true);
    // no edges between different cases
    expect(graph.forward.get(case0)!.has(case1)).toBe(false);
    expect(graph.forward.get(case1)!.has(case0)).toBe(false);
  });

  it('forward + reverse maps are consistent for all edges', async () => {
    const graph = await buildFromFile('examples/adpl/04-branch-by-tags.yaml');
    for (const prereq of graph.allNodes) {
      for (const dep of graph.forward.get(prereq)!) {
        expect(graph.reverse.get(dep)!.has(prereq)).toBe(true);
      }
    }
    for (const dep of graph.allNodes) {
      for (const prereq of graph.reverse.get(dep)!) {
        expect(graph.forward.get(prereq)!.has(dep)).toBe(true);
      }
    }
  });

  it('all 10 samples: buildAdjacency succeeds, map sizes match allNodes', async () => {
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
      const graph = await buildFromFile(sample);
      expect(graph.allNodes.length, `${sample} allNodes`).toBeGreaterThan(0);
      expect(graph.forward.size, `${sample} forward size`).toBe(graph.allNodes.length);
      expect(graph.reverse.size, `${sample} reverse size`).toBe(graph.allNodes.length);
    }
  });
});
