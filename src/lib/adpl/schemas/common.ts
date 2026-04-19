import { z } from 'zod';
import { ConditionSchema } from './expression';

export const NodeIdSchema = z.string().min(1, '노드 id는 비어있을 수 없습니다');
export const ISOTimestampSchema = z.string().datetime();

export const FailurePolicySchema = z.enum(['abort', 'continue', 'retry']);

export const NodeStatusSchema = z.enum([
  'pending',
  'ready',
  'running',
  'success',
  'failure',
  'cancelled',
  'skipped',
  'waiting',
] as const);

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().positive(),
  backoff: z.enum(['linear', 'exponential', 'fixed']).optional(),
  initialDelay: z.number().int().positive().optional(),
  maxDelay: z.number().int().positive().optional(),
});

export const NodeSpecBaseSchema = z.object({
  id: NodeIdSchema,
  type: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  when: ConditionSchema.optional(),
  onFailure: FailurePolicySchema.optional(),
  timeout: z.number().optional(),
  retryPolicy: RetryPolicySchema.optional(),
  dependsOn: z.array(z.string()).optional(),
});
