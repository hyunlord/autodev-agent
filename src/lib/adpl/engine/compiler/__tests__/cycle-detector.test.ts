import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseYaml } from '../yaml-parser';
import { extractFlat } from '../flat-extractor';
import { resolveReferences } from '../ref-resolver';
import { buildAdjacency } from '../adjacency';
import { detectCycle } from '../cycle-detector';
import type { AdjacencyGraph } from '../adjacency';

async function detectFromFile(relativePath: string) {
  const yaml = readFileSync(join(process.cwd(), relativePath), 'utf-8');
  const parsed = await parseYaml({ yaml, sourcePath: relativePath });
  const extraction = extractFlat(parsed);
  const resolved = resolveReferences(extraction);
  const graph = buildAdjacency(extraction, resolved);
  return detectCycle(graph);
}

function makeGraph(nodes: string[], edges: [string, string][]): AdjacencyGraph {
  const forward = new Map<string, Set<string>>(nodes.map((n) => [n, new Set()]));
  const reverse = new Map<string, Set<string>>(nodes.map((n) => [n, new Set()]));
  for (const [a, b] of edges) {
    forward.get(a)!.add(b);
    reverse.get(b)!.add(a);
  }
  return { forward, reverse, allNodes: nodes };
}

describe('detectCycle', () => {
  it('no cycle: valid pipeline — topological order returned, plan before code before verify', async () => {
    const result = await detectFromFile('examples/adpl/02-plan-code-verify.yaml');
    expect(result.hasCycle).toBe(false);
    expect(result.topologicalOrder.length).toBeGreaterThan(0);
    expect(result.cycleNodes).toHaveLength(0);
    expect(result.error).toBeNull();
    const order = result.topologicalOrder;
    expect(order.indexOf('pipeline.0')).toBeLessThan(order.indexOf('pipeline.1'));
    expect(order.indexOf('pipeline.1')).toBeLessThan(order.indexOf('pipeline.2'));
  });

  it('self-loop: single node pointing to itself', () => {
    const graph = makeGraph(['a'], [['a', 'a']]);
    const result = detectCycle(graph);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes).toContain('a');
    expect(result.topologicalOrder).toHaveLength(0);
    expect(result.error).not.toBeNull();
  });

  it('direct cycle A → B → A', () => {
    const graph = makeGraph(['a', 'b'], [['a', 'b'], ['b', 'a']]);
    const result = detectCycle(graph);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes).toContain('a');
    expect(result.cycleNodes).toContain('b');
    expect(result.error!.code).toBe('cycle_detected');
  });

  it('indirect cycle A → B → C → A', () => {
    const graph = makeGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']]);
    const result = detectCycle(graph);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes).toHaveLength(3);
    expect(result.cycleNodes).toContain('a');
    expect(result.cycleNodes).toContain('b');
    expect(result.cycleNodes).toContain('c');
  });

  it('partial cycle: a is OK, b+c form cycle', () => {
    // a→b, b→c, c→b — a reaches cycle but is not part of it
    const graph = makeGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'b']]);
    const result = detectCycle(graph);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes).toContain('b');
    expect(result.cycleNodes).toContain('c');
    expect(result.cycleNodes).not.toContain('a');
  });

  it('cycle error message is Korean and lists node names', () => {
    const graph = makeGraph(['a', 'b'], [['a', 'b'], ['b', 'a']]);
    const result = detectCycle(graph);
    expect(result.error!.message).toContain('순환 의존성 감지');
    expect(result.error!.message).toContain('"a"');
    expect(result.error!.message).toContain('"b"');
  });

  it('all 10 samples: hasCycle false', async () => {
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
      const result = await detectFromFile(sample);
      expect(result.hasCycle, `${sample} should have no cycle`).toBe(false);
    }
  });
});
