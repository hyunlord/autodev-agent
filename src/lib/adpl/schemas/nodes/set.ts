import { z } from 'zod';
import { NodeSpecBaseSchema } from '../common';
import { ExpressionSchema } from '../expression';

export const SetNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('set'),
  values: z.record(ExpressionSchema),
});
