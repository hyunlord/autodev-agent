import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseYaml } from '../yaml-parser';
import { extractFlat } from '../flat-extractor';
import { resolveReferences } from '../ref-resolver';

async function resolveFromFile(relativePath: string) {
  const yamlStr = readFileSync(join(process.cwd(), relativePath), 'utf-8');
  const parsed = await parseYaml({ yaml: yamlStr, sourcePath: relativePath });
  const extraction = extractFlat(parsed);
  return resolveReferences(extraction);
}

async function resolveFromYaml(yaml: string) {
  const parsed = await parseYaml({ yaml });
  const extraction = extractFlat(parsed);
  return resolveReferences(extraction);
}

describe('resolveReferences', () => {
  it('01-hello-world: 참조 없음 — errors 0, byNode populated', async () => {
    const result = await resolveFromFile('examples/adpl/01-hello-world.yaml');
    expect(result.errors).toHaveLength(0);
    expect(result.byNode.size).toBeGreaterThan(0);
    // 모든 노드에 빈 references 배열
    for (const nr of result.byNode.values()) {
      expect(nr.references).toHaveLength(0);
    }
  });

  it('02-plan-code-verify: valid forward chain — errors 0, resolved 판정', async () => {
    const result = await resolveFromFile('examples/adpl/02-plan-code-verify.yaml');
    expect(result.errors).toHaveLength(0);
    // code(pipeline.1) references plan
    const codeRefs = result.byNode.get('pipeline.1');
    expect(codeRefs).toBeDefined();
    expect(codeRefs!.references).toHaveLength(1);
    expect(codeRefs!.references[0].targetUserId).toBe('plan');
    expect(codeRefs!.references[0].resolution.kind).toBe('resolved');
    // verify(pipeline.2) references code
    const verifyRefs = result.byNode.get('pipeline.2');
    expect(verifyRefs).toBeDefined();
    expect(verifyRefs!.references[0].targetUserId).toBe('code');
    expect(verifyRefs!.references[0].resolution.kind).toBe('resolved');
  });

  it('04-branch-by-tags: branch 내부 노드가 top-level 이전 노드 참조 — errors 0', async () => {
    const result = await resolveFromFile('examples/adpl/04-branch-by-tags.yaml');
    expect(result.errors).toHaveLength(0);
    // ui-review(pipeline.2.cases.0.then.0)가 code(pipeline.1) 참조
    const uiRefs = result.byNode.get('pipeline.2.cases.0.then.0');
    expect(uiRefs).toBeDefined();
    expect(uiRefs!.references[0].resolution.kind).toBe('resolved');
    expect(uiRefs!.references[0].targetUserId).toBe('code');
  });

  it('forward_reference 감지: top-level 앞 노드가 뒤 노드 참조', async () => {
    const result = await resolveFromYaml(`
adplVersion: 1
name: fwd-test
pipeline:
  - id: early
    type: agent
    role: custom
    prompt: "$nodes.later.output"
  - id: later
    type: agent
    role: planner
`);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('forward_reference');
    expect(result.errors[0].pathId).toBe('pipeline.0');
    expect(result.errors[0].reference.targetUserId).toBe('later');
    const earlyRefs = result.byNode.get('pipeline.0');
    expect(earlyRefs!.references[0].resolution.kind).toBe('forward_reference');
  });

  it('자기 참조는 forward_reference로 분류', async () => {
    const result = await resolveFromYaml(`
adplVersion: 1
name: self-test
pipeline:
  - id: self-node
    type: agent
    role: custom
    prompt: "$nodes.self-node.output"
`);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('forward_reference');
    expect(result.errors[0].pathId).toBe('pipeline.0');
  });

  it('unknown_target 감지: 존재하지 않는 노드 참조', async () => {
    const result = await resolveFromYaml(`
adplVersion: 1
name: unknown-test
pipeline:
  - id: only
    type: agent
    role: custom
    prompt: "$nodes.nothing.output"
`);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('unknown_target');
    expect(result.errors[0].pathId).toBe('pipeline.0');
    expect(result.errors[0].reference.targetUserId).toBe('nothing');
  });

  it('parallel_sibling 감지: 같은 parallel 내 형제 branch 참조 금지', async () => {
    const result = await resolveFromYaml(`
adplVersion: 1
name: sibling-test
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
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('parallel_sibling');
    expect(result.errors[0].reference.targetUserId).toBe('lint-cmd');
    const testCmdRefs = result.byNode.get('pipeline.0.branches.1.nodes.0');
    expect(testCmdRefs!.references[0].resolution.kind).toBe('parallel_sibling');
  });

  it('parallel 이후 노드가 parallel 내부 노드 참조 — OK (errors 0)', async () => {
    const result = await resolveFromYaml(`
adplVersion: 1
name: parallel-outer-test
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
            command: "pnpm test"
  - id: report
    type: agent
    role: custom
    prompt: "$nodes.lint-cmd.output"
`);
    expect(result.errors).toHaveLength(0);
    const reportRefs = result.byNode.get('pipeline.1');
    expect(reportRefs).toBeDefined();
    expect(reportRefs!.references[0].targetUserId).toBe('lint-cmd');
    expect(reportRefs!.references[0].resolution.kind).toBe('resolved');
  });

  it('bracket notation $nodes["kebab-id"] 감지 및 resolved', async () => {
    const result = await resolveFromYaml(`
adplVersion: 1
name: bracket-test
pipeline:
  - id: create-issue
    type: agent
    role: planner
  - id: notify
    type: agent
    role: custom
    prompt: "$nodes['create-issue'].output.data"
`);
    expect(result.errors).toHaveLength(0);
    const notifyRefs = result.byNode.get('pipeline.1');
    expect(notifyRefs).toBeDefined();
    expect(notifyRefs!.references[0].targetUserId).toBe('create-issue');
    expect(notifyRefs!.references[0].resolution.kind).toBe('resolved');
  });

  it('mixed: 한 노드에서 resolved + forward_reference 동시 발생', async () => {
    const result = await resolveFromYaml(`
adplVersion: 1
name: mixed-test
pipeline:
  - id: first
    type: agent
    role: planner
  - id: middle
    type: agent
    role: custom
    prompt: "$nodes.first.output and $nodes.future.output"
  - id: future
    type: agent
    role: custom
    prompt: "done"
`);
    // future 참조만 에러
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('forward_reference');
    expect(result.errors[0].reference.targetUserId).toBe('future');
    // first 참조는 resolved
    const middleRefs = result.byNode.get('pipeline.1')!.references;
    const firstRef = middleRefs.find((r) => r.targetUserId === 'first');
    expect(firstRef?.resolution.kind).toBe('resolved');
  });

  it('같은 string 내 복수 $nodes 참조 — 모두 감지', async () => {
    const result = await resolveFromYaml(`
adplVersion: 1
name: multi-ref-test
pipeline:
  - id: a
    type: agent
    role: planner
  - id: b
    type: agent
    role: custom
    prompt: "$nodes.a.output.severity $nodes.a.output.summary"
`);
    expect(result.errors).toHaveLength(0);
    const bRefs = result.byNode.get('pipeline.1')!.references;
    // 같은 string에서 두 번 매치
    expect(bRefs.filter((r) => r.targetUserId === 'a')).toHaveLength(2);
  });

  it('한국어 에러 메시지: pathId + target + 조치 권고 포함', async () => {
    const fwdResult = await resolveFromYaml(`
adplVersion: 1
name: msg-fwd
pipeline:
  - id: early
    type: agent
    role: custom
    prompt: "$nodes.later.output"
  - id: later
    type: agent
    role: planner
`);
    expect(fwdResult.errors[0].message).toContain('앞으로의 노드 참조 금지');
    expect(fwdResult.errors[0].message).toContain('pipeline.0');
    expect(fwdResult.errors[0].message).toContain('later');
    expect(fwdResult.errors[0].message).toContain('배치하세요');

    const unkResult = await resolveFromYaml(`
adplVersion: 1
name: msg-unk
pipeline:
  - id: only
    type: agent
    role: custom
    prompt: "$nodes.ghost.output"
`);
    expect(unkResult.errors[0].message).toContain('알 수 없는 노드 참조');
    expect(unkResult.errors[0].message).toContain('ghost');

    const sibResult = await resolveFromYaml(`
adplVersion: 1
name: msg-sib
pipeline:
  - id: par
    type: parallel
    mergeStrategy: all_must_pass
    branches:
      - id: b0
        nodes:
          - id: n0
            type: shell
            command: "echo a"
      - id: b1
        nodes:
          - id: n1
            type: shell
            command: "echo $nodes.n0.output"
`);
    expect(sibResult.errors[0].message).toContain('형제 branch 참조 금지');
    expect(sibResult.errors[0].message).toContain('n0');
  });

  it('모든 10개 샘플: parse + extract + resolve, errors 0', async () => {
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
      const result = await resolveFromFile(sample);
      expect(result.errors, `${sample} should have no reference errors`).toHaveLength(0);
    }
  });
});
