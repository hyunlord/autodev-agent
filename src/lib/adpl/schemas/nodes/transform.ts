import { z } from 'zod';
import { NodeSpecBaseSchema } from '../common';
import { ExpressionSchema, ConditionSchema } from '../expression';
import type { TransformParams } from '../../types/nodes/transform';

export const TransformOperationSchema = z.enum(['filter', 'map', 'pluck'] as const);

export const FilterParamsSchema = z.object({
  where: ConditionSchema,
});

export const MapParamsSchema = z.object({
  template: z.record(ExpressionSchema),
});

export const PluckParamsSchema = z.object({
  field: z.string(),
});

export const TransformParamsSchema: z.ZodType<TransformParams> = z.union([
  FilterParamsSchema,
  MapParamsSchema,
  PluckParamsSchema,
]);

export const TransformNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('transform'),
  input: ExpressionSchema,
  operation: TransformOperationSchema,
  params: TransformParamsSchema,
});
