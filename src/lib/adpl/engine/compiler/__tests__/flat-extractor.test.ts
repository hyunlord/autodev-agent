import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseYaml } from '../yaml-parser';
import { extractFlat } from '../flat-extractor';
import type { ParsedPipeline } from '../yaml-parser';

async function parseFromFile(relativePath: string): Promise<ParsedPipeline> {
  const yamlStr = readFileSync(join(process.cwd(), relativePath), 'utf-8');
  return parseYaml({ yaml: yamlStr, sourcePath: relativePath });
}

describe('extractFlat', () => {
  it('01-hello-world: 1 노드, rootNodes, depth=0, parentFlowId=null', async () => {
    const parsed = await parseFromFile('examples/adpl/01-hello-world.yaml');
    const result = extractFlat(parsed);

    expect(result.nodes).toHaveLength(1);
    expect(result.rootNodes).toEqual(['pipeline.0']);
    expect(result.nodes[0].depth).toBe(0);
    expect(result.nodes[0].parentFlowId).toBeNull();
    expect(result.nodes[0].userId).toBe('greet');
    expect(result.nodes[0].children).toHaveLength(0);
  });

  it('01-hello-world: userIdToPath 매핑 정확', async () => {
    const parsed = await parseFromFile('examples/adpl/01-hello-world.yaml');
    const result = extractFlat(parsed);

    expect(result.userIdToPath.get('greet')).toEqual(['pipeline.0']);
  });

  it('04-branch-by-tags: branch 노드의 children 존재, 내부 노드 depth=1', async () => {
    const parsed = await parseFromFile('examples/adpl/04-branch-by-tags.yaml');
    const result = extractFlat(parsed);

    // pipeline.0=plan, pipeline.1=code, pipeline.2=route(branch)
    const routeNode = result.nodesByPath.get('pipeline.2');
    expect(routeNode).toBeDefined();
    expect(routeNode!.spec.type).toBe('branch');
    expect(routeNode!.children.length).toBeGreaterThan(0);

    // 내부 노드 depth=1
    for (const childPathId of routeNode!.children) {
      const childNode = result.nodesByPath.get(childPathId);
      expect(childNode).toBeDefined();
      expect(childNode!.depth).toBe(1);
      expect(childNode!.parentFlowId).toBe('pipeline.2');
    }
  });

  it('04-branch-by-tags: 내부 노드 pathId 패턴 = pipeline.2.cases.N.then.0', async () => {
    const parsed = await parseFromFile('examples/adpl/04-branch-by-tags.yaml');
    const result = extractFlat(parsed);

    // cases 0,1,2 각각 then 에 1개 노드
    expect(result.nodesByPath.has('pipeline.2.cases.0.then.0')).toBe(true);
    expect(result.nodesByPath.has('pipeline.2.cases.1.then.0')).toBe(true);
    expect(result.nodesByPath.has('pipeline.2.cases.2.then.0')).toBe(true);
  });

  it('03-parallel-checks: parallel 내부 노드 pathId = pipeline.0.branches.N.nodes.0', async () => {
    const parsed = await parseFromFile('examples/adpl/03-parallel-checks.yaml');
    const result = extractFlat(parsed);

    // pipeline.0 = checks(parallel), pipeline.1 = notify
    const checksNode = result.nodesByPath.get('pipeline.0');
    expect(checksNode).toBeDefined();
    expect(checksNode!.spec.type).toBe('parallel');

    expect(result.nodesByPath.has('pipeline.0.branches.0.nodes.0')).toBe(true);
    expect(result.nodesByPath.has('pipeline.0.branches.1.nodes.0')).toBe(true);
    expect(result.nodesByPath.has('pipeline.0.branches.2.nodes.0')).toBe(true);

    // 내부 노드 depth=1, parentFlowId='pipeline.0'
    const innerNode = result.nodesByPath.get('pipeline.0.branches.0.nodes.0');
    expect(innerNode!.depth).toBe(1);
    expect(innerNode!.parentFlowId).toBe('pipeline.0');
  });

  it('05-loop-foreach: loop 내부 노드 pathId = pipeline.1.do.0', async () => {
    const parsed = await parseFromFile('examples/adpl/05-loop-foreach.yaml');
    const result = extractFlat(parsed);

    // pipeline.0 = verify(agent), pipeline.1 = create-tickets(loop)
    const loopNode = result.nodesByPath.get('pipeline.1');
    expect(loopNode).toBeDefined();
    expect(loopNode!.spec.type).toBe('loop');

    expect(result.nodesByPath.has('pipeline.1.do.0')).toBe(true);

    const doNode = result.nodesByPath.get('pipeline.1.do.0');
    expect(doNode!.depth).toBe(1);
    expect(doNode!.parentFlowId).toBe('pipeline.1');
  });

  it('userIdToPath: 같은 userId가 여러 경로에 나타날 때 모두 기록', async () => {
    // 수동 YAML — branch 두 case에 같은 id를 쓰면 스키마 중복 체크를 피하기 위해
    // 스키마는 pipeline 최상위 레벨 id만 체크하므로 중첩 중복은 허용됨
    const duplicateYaml = `
adplVersion: 1
name: dup-test
pipeline:
  - id: route
    type: branch
    cases:
      - when:
          field: "$x"
          eq: "a"
        then:
          - id: shared-node
            type: shell
            command: "echo a"
      - when:
          field: "$x"
          eq: "b"
        then:
          - id: shared-node
            type: shell
            command: "echo b"
`;
    const parsed = await parseYaml({ yaml: duplicateYaml });
    const result = extractFlat(parsed);

    const paths = result.userIdToPath.get('shared-node');
    expect(paths).toBeDefined();
    expect(paths!.length).toBe(2);
    expect(paths).toContain('pipeline.0.cases.0.then.0');
    expect(paths).toContain('pipeline.0.cases.1.then.0');
  });

  it('10-complex-ci: maxDepth >= 2', async () => {
    const parsed = await parseFromFile('examples/adpl/10-complex-ci.yaml');
    const result = extractFlat(parsed);

    const maxDepth = Math.max(...result.nodes.map((n) => n.depth));
    expect(maxDepth).toBeGreaterThanOrEqual(2);
  });

  it('10-complex-ci: nodes.length > 0 및 rootNodes 존재', async () => {
    const parsed = await parseFromFile('examples/adpl/10-complex-ci.yaml');
    const result = extractFlat(parsed);

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.rootNodes.length).toBeGreaterThan(0);
  });

  it('모든 10개 샘플: parse + extract 성공, nodes.length > 0', async () => {
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
      const parsed = await parseFromFile(sample);
      const result = extractFlat(parsed);
      expect(result.nodes.length).toBeGreaterThan(0);
    }
  });

  it('siblings: 같은 레벨 노드들이 서로를 siblings 에 포함', async () => {
    const parsed = await parseFromFile('examples/adpl/03-parallel-checks.yaml');
    const result = extractFlat(parsed);

    // pipeline.0(checks), pipeline.1(notify) 는 서로 siblings
    const node0 = result.nodesByPath.get('pipeline.0');
    const node1 = result.nodesByPath.get('pipeline.1');
    expect(node0!.siblings).toContain('pipeline.0');
    expect(node0!.siblings).toContain('pipeline.1');
    expect(node1!.siblings).toContain('pipeline.0');
    expect(node1!.siblings).toContain('pipeline.1');
  });
});
