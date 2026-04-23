import { z } from 'zod';
import { NodeSpecBaseSchema } from '../common';
import { StructuredConditionSchema } from '../expression';

// human-approval gate 알림 설정 (Stage 5+ 구현 예정, 타입 호환용 유지)
export const NotifyConfigSchema = z.object({
  channels: z.array(z.string()).optional(),
  webhookUrl: z.string().optional(),
  reminderAfter: z.number().optional(),
  messageTemplate: z.string().optional(),
});

/**
 * D4 조건 게이트 스키마.
 * condition 평가 true → 통과, false → onFail 정책 적용.
 */
export const GateNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('gate'),
  condition: StructuredConditionSchema,
  onFail: z.enum(['throw', 'fail_node']).optional(),
  message: z.string().optional(),
});
