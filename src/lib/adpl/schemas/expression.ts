import { z } from 'zod';
import type { Condition, StructuredCondition, FieldCondition } from '../types/expression';

export const ExpressionSchema = z.string();

export const FieldConditionSchema: z.ZodType<FieldCondition> = z.object({
  field: z.string(),
  transform: z.enum(['lower', 'upper', 'length']).optional(),
  eq: z.unknown().optional(),
  neq: z.unknown().optional(),
  lt: z.union([z.number(), z.string()]).optional(),
  lte: z.union([z.number(), z.string()]).optional(),
  gt: z.union([z.number(), z.string()]).optional(),
  gte: z.union([z.number(), z.string()]).optional(),
  in: z.array(z.unknown()).optional(),
  nin: z.array(z.unknown()).optional(),
  contains: z.unknown().optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  matches: z.string().optional(),
  exists: z.boolean().optional(),
  empty: z.boolean().optional(),
  truthy: z.boolean().optional(),
});

export const StructuredConditionSchema: z.ZodType<StructuredCondition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(StructuredConditionSchema) }),
    z.object({ any: z.array(StructuredConditionSchema) }),
    z.object({ not: StructuredConditionSchema }),
    FieldConditionSchema,
  ])
);

export const ConditionSchema: z.ZodType<Condition> = z.union([
  StructuredConditionSchema,
  z.string(),
]);
