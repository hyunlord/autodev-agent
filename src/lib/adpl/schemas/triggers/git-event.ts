import { z } from 'zod';
import { ConditionSchema } from '../expression';

export const GitEventTypeSchema = z.enum([
  'pr_opened',
  'pr_updated',
  'pr_merged',
  'pr_closed',
  'push',
  'tag_created',
  'tag_deleted',
] as const);

export const WebhookConfigSchema = z.object({
  provider: z.enum(['github', 'gitlab']),
  secret: z.string(),
});

export const GitFilterSchema = z.object({
  branches: z.array(z.string()).optional(),
  paths: z.array(z.string()).optional(),
  prLabels: z.array(z.string()).optional(),
  ignorePaths: z.array(z.string()).optional(),
});

export const GitEventTriggerSchema = z.object({
  id: z.string().optional(),
  type: z.literal('git_event'),
  enabled: z.boolean().optional(),
  source: z.enum(['webhook', 'poll']).optional(),
  webhookConfig: WebhookConfigSchema.optional(),
  events: z.array(GitEventTypeSchema),
  filter: z.union([GitFilterSchema, ConditionSchema]).optional(),
});
