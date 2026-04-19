import { z } from 'zod';
import { NodeSpecBaseSchema } from '../common';

export const NotifyConfigSchema = z.object({
  channels: z.array(z.string()).optional(),
  webhookUrl: z.string().optional(),
  reminderAfter: z.number().optional(),
  messageTemplate: z.string().optional(),
});

export const GateNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('gate'),
  prompt: z.string(),
  options: z.array(z.string()),
  defaultOption: z.string().optional(),
  artifactsToShow: z.array(z.string()).optional(),
  notifyConfig: NotifyConfigSchema.optional(),
});
