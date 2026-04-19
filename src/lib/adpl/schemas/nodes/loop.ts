import { z } from 'zod';
import { NodeSpecBaseSchema } from '../common';
import { ConditionSchema } from '../expression';
import type { NodeSpec } from '../../types/nodes/index';
// NodeSpecSchema는 z.lazy 내부에서만 접근 — ESM live binding으로 순환 의존 해결
import { NodeSpecSchema } from './index';

export const LoopModeSchema = z.enum(['forEach', 'times', 'while'] as const);

export const LoopNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('loop'),
  mode: LoopModeSchema,
  over: z.string().optional(),
  as: z.string().optional(),
  count: z.number().int().positive().optional(),
  condition: ConditionSchema.optional(),
  maxIterations: z.number().int().positive().optional(),
  do: z.lazy((): z.ZodType<NodeSpec[]> => z.array(NodeSpecSchema)),
  parallelism: z.number().int().positive().optional(),
  continueOnIterFailure: z.boolean().optional(),
  aggregateResults: z.boolean().optional(),
  breakCondition: ConditionSchema.optional(),
});
