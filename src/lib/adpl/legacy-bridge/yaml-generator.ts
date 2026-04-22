import { dump } from 'js-yaml';
import type { AdplPipeline } from '@/lib/adpl/types/pipeline';
import type { AgentNodeSpec } from '@/lib/adpl/types/nodes/agent';
import type { ShellNodeSpec } from '@/lib/adpl/types/nodes/shell';

export interface LegacyEquivalentOptions {
  projectId: string;
  hookNodes?: ShellNodeSpec[];
}

/**
 * legacy Plan→Code→Verify 파이프라인에 해당하는 AdplPipeline 객체를 생성.
 *
 * hookNodes 분류:
 *   - dependsOn 미설정 (undefined | [])  → plan 이전에 삽입 (pre-plan hooks)
 *   - dependsOn includes 'plan'           → plan 이후 (post-plan hooks, before code)
 *   - dependsOn includes 'code'           → code 이후 (post-code hooks, before verify)
 *   - dependsOn includes 'verify'         → verify 이후 (post-verify hooks)
 *
 * hook-converter.ts 규칙: 'after' 배치 hook → dependsOn: [phaseId] 설정,
 *                         'before' 배치 hook → dependsOn 미설정
 */
export function buildLegacyEquivalentPipeline(
  options: LegacyEquivalentOptions,
): AdplPipeline {
  const hookNodes = options.hookNodes ?? [];

  const prePlanHooks = hookNodes.filter(
    (n) => !n.dependsOn || n.dependsOn.length === 0,
  );
  const postPlanHooks = hookNodes.filter(
    (n) =>
      n.dependsOn?.includes('plan') &&
      !n.dependsOn.includes('code') &&
      !n.dependsOn.includes('verify'),
  );
  const postCodeHooks = hookNodes.filter(
    (n) =>
      n.dependsOn?.includes('code') && !n.dependsOn.includes('verify'),
  );
  const postVerifyHooks = hookNodes.filter((n) =>
    n.dependsOn?.includes('verify'),
  );

  const plan: AgentNodeSpec = {
    id: 'plan',
    type: 'agent',
    role: 'planner',
  };

  const code: AgentNodeSpec = {
    id: 'code',
    type: 'agent',
    role: 'coder',
    dependsOn: ['plan'],
  };

  const verify: AgentNodeSpec = {
    id: 'verify',
    type: 'agent',
    role: 'verifier',
    dependsOn: ['code'],
  };

  return {
    adplVersion: 1,
    name: 'legacy-equivalent-default',
    description: 'Auto-generated from legacy Plan→Code→Verify pipeline',
    pipeline: [
      ...prePlanHooks,
      plan,
      ...postPlanHooks,
      code,
      ...postCodeHooks,
      verify,
      ...postVerifyHooks,
    ],
  };
}

/** AdplPipeline 객체를 YAML 문자열로 직렬화 */
export function serializeToYaml(spec: AdplPipeline): string {
  return dump(spec, {
    noRefs: true,
    sortKeys: false,
    lineWidth: 120,
  });
}
