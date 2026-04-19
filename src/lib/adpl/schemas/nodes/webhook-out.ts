import { z } from 'zod';
import { NodeSpecBaseSchema, RetryPolicySchema } from '../common';

export const WebhookOutProviderSchema = z.enum([
  'slack',
  'discord',
  'teams',
  'generic',
] as const);

export const WebhookOutNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('webhook_out'),
  provider: WebhookOutProviderSchema.optional(),
  url: z.string(),
  body: z.record(z.unknown()),
  silentFail: z.boolean().optional(),
  failOnError: z.boolean().optional(),
  rateLimitPerMinute: z.number().int().positive().optional(),
  retryPolicy: RetryPolicySchema.optional(),
});
