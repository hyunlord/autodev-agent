import { z } from 'zod';
import { RetryPolicySchema, FailurePolicySchema } from './common';
import { NodeSpecSchema } from './nodes/index';
import { TriggerSpecSchema } from './triggers/index';

export const PipelineSettingsSchema = z.object({
  maxParallel: z.number().int().positive().optional(),
  totalTimeout: z.number().int().positive().optional(),
  nodeTimeout: z.number().int().positive().optional(),
  onNodeFailure: FailurePolicySchema.optional(),
  totalCostLimit: z.number().positive().nullable().optional(),
  retryPolicy: RetryPolicySchema.nullable().optional(),
  allowedEnvKeys: z.array(z.string()).optional(),
});

export const AdplPipelineSchema = z
  .object({
    adplVersion: z.literal(1),
    name: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, '파이프라인 이름은 소문자/숫자/하이픈만 허용됩니다'),
    description: z.string().max(500).optional(),
    triggers: z.array(TriggerSpecSchema).optional(),
    pipeline: z.array(NodeSpecSchema).min(1, '파이프라인은 최소 1개의 노드가 필요합니다'),
    settings: PipelineSettingsSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .superRefine((data, ctx) => {
    // 노드 id 중복 체크
    const nodeIds = new Set<string>();
    data.pipeline.forEach((node, idx) => {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `노드 id "${node.id}" 가 중복됩니다`,
          path: ['pipeline', idx, 'id'],
        });
      }
      nodeIds.add(node.id);
    });

    // trigger id 중복 체크
    if (data.triggers) {
      const triggerIds = new Set<string>();
      data.triggers.forEach((trigger, idx) => {
        const tid = trigger.id;
        if (tid !== undefined) {
          if (triggerIds.has(tid)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `트리거 id "${tid}" 가 중복됩니다`,
              path: ['triggers', idx, 'id'],
            });
          }
          triggerIds.add(tid);
        }
      });
    }

    // agent role=custom이면 prompt 필수
    data.pipeline.forEach((node, idx) => {
      if (node.type === 'agent' && node.role === 'custom' && !node.prompt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'role이 "custom"인 경우 prompt 필드가 필요합니다',
          path: ['pipeline', idx, 'prompt'],
        });
      }
    });
  });
