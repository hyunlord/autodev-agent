import { z } from 'zod';
import { ConditionSchema } from '../expression';

export const TaskCreatedTriggerSchema = z.object({
  id: z.string().optional(),
  type: z.literal('task_created'),
  enabled: z.boolean().optional(),
  filter: ConditionSchema.optional(),
  projectId: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
