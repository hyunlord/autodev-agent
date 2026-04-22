import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { buildLegacyEquivalentPipeline, serializeToYaml } from '../yaml-generator';
import type { AdplPipeline } from '@/lib/adpl/types/pipeline';
import type { ShellNodeSpec } from '@/lib/adpl/types/nodes/shell';

describe('buildLegacyEquivalentPipeline', () => {
  it('1. hookNodes 없을 때 plan→code→verify 3-노드 파이프라인 생성', () => {
    const spec = buildLegacyEquivalentPipeline({ projectId: 'proj-1' });

    expect(spec.pipeline).toHaveLength(3);
    expect(spec.pipeline[0]).toMatchObject({ id: 'plan', type: 'agent', role: 'planner' });
    expect(spec.pipeline[1]).toMatchObject({ id: 'code', type: 'agent', role: 'coder', dependsOn: ['plan'] });
    expect(spec.pipeline[2]).toMatchObject({ id: 'verify', type: 'agent', role: 'verifier', dependsOn: ['code'] });
  });

  it('2. hookNodes 삽입 — pre/post 위치에 올바르게 배치', () => {
    const prePlanHook: ShellNodeSpec = {
      id: 'session-start',
      type: 'shell',
      mode: 'shell',
      command: 'echo start',
      // dependsOn 미설정 → pre-plan
    };
    const postPlanHook: ShellNodeSpec = {
      id: 'post-plan',
      type: 'shell',
      mode: 'shell',
      command: 'echo post-plan',
      dependsOn: ['plan'],
    };
    const postCodeHook: ShellNodeSpec = {
      id: 'post-code',
      type: 'shell',
      mode: 'shell',
      command: 'pnpm lint',
      dependsOn: ['code'],
    };
    const postVerifyHook: ShellNodeSpec = {
      id: 'post-verify',
      type: 'shell',
      mode: 'shell',
      command: 'echo done',
      dependsOn: ['verify'],
    };

    const spec = buildLegacyEquivalentPipeline({
      projectId: 'proj-1',
      hookNodes: [prePlanHook, postPlanHook, postCodeHook, postVerifyHook],
    });

    const ids = spec.pipeline.map((n) => n.id);
    expect(ids).toEqual([
      'session-start', // pre-plan
      'plan',
      'post-plan',    // after plan
      'code',
      'post-code',    // after code
      'verify',
      'post-verify',  // after verify
    ]);
  });

  it('3. serializeToYaml 라운드트립 — dump 후 load하면 동일 구조', () => {
    const spec = buildLegacyEquivalentPipeline({ projectId: 'proj-1' });
    const yaml = serializeToYaml(spec);
    const parsed = load(yaml) as AdplPipeline;

    expect(parsed.adplVersion).toBe(1);
    expect(parsed.name).toBe('legacy-equivalent-default');
    expect(Array.isArray(parsed.pipeline)).toBe(true);
    expect(parsed.pipeline).toHaveLength(3);
    expect(parsed.pipeline[0]).toMatchObject({ id: 'plan', type: 'agent', role: 'planner' });
    expect(parsed.pipeline[1]).toMatchObject({ id: 'code', type: 'agent', role: 'coder' });
    expect(parsed.pipeline[2]).toMatchObject({ id: 'verify', type: 'agent', role: 'verifier' });
  });

  it('4. adplVersion=1(숫자), name="legacy-equivalent-default" 확인', () => {
    const spec = buildLegacyEquivalentPipeline({ projectId: 'proj-1' });
    expect(spec.adplVersion).toBe(1);
    expect(spec.name).toBe('legacy-equivalent-default');
    expect(/^[a-z0-9][a-z0-9\-]{0,62}$/.test(spec.name)).toBe(true);
  });

  it('5. 생성된 YAML에 필수 필드 포함 (adplVersion, name, pipeline)', () => {
    const spec = buildLegacyEquivalentPipeline({ projectId: 'proj-1' });
    const yaml = serializeToYaml(spec);

    expect(yaml).toContain('adplVersion: 1');
    expect(yaml).toContain('name: legacy-equivalent-default');
    expect(yaml).toContain('pipeline:');
    expect(yaml).toContain('role: planner');
    expect(yaml).toContain('role: coder');
    expect(yaml).toContain('role: verifier');
  });
});
