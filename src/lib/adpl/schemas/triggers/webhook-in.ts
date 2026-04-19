import { z } from 'zod';
import { ConditionSchema } from '../expression';

export const WebhookAuthSchema = z.enum(['none', 'header', 'hmac', 'basic'] as const);
export const WebhookResponseModeSchema = z.enum(['immediate', 'sync'] as const);

export const WebhookInTriggerSchema = z.object({
  id: z.string().optional(),
  type: z.literal('webhook_in'),
  enabled: z.boolean().optional(),
  path: z.string(),
  method: z.enum(['POST', 'GET']).optional(),
  auth: WebhookAuthSchema.optional(),
  secret: z.string().optional(),
  responseMode: WebhookResponseModeSchema.optional(),
  rateLimitPerMinute: z.number().int().positive().optional(),
  filter: ConditionSchema.optional(),
});
