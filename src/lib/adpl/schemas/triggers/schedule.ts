import { z } from 'zod';

export const ScheduleModeSchema = z.enum(['cron', 'interval', 'once'] as const);
export const OverlapModeSchema = z.enum(['skip', 'queue', 'concurrent'] as const);

export const ScheduleTriggerSchema = z.object({
  id: z.string().optional(),
  type: z.literal('schedule'),
  enabled: z.boolean().optional(),
  mode: ScheduleModeSchema,
  cron: z.string().optional(),
  interval: z.number().int().positive().optional(),
  at: z.string().optional(),
  timezone: z.string().optional(),
  overlap: OverlapModeSchema.optional(),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  maxRuns: z.number().int().positive().optional(),
});
