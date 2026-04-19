import { z } from 'zod';
import { NodeStatusSchema } from './common';

export const ErrorCategorySchema = z.enum([
  'transient',
  'persistent',
  'quality',
  'cost_limit',
  'cancellation',
  'policy_violation',
  'timeout',
] as const);

export const AdplErrorCodeSchema = z.string();

export const NodeErrorSchema = z.object({
  code: AdplErrorCodeSchema,
  message: z.string(),
  category: ErrorCategorySchema,
  details: z.unknown().optional(),
});

export const NodeMetricsSchema = z.object({
  durationMs: z.number(),
  costUsd: z.number().optional(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
});

export const NodeOutputSchema = z.object({
  status: NodeStatusSchema,
  data: z.unknown().optional(),
  error: NodeErrorSchema.optional(),
  metrics: NodeMetricsSchema.optional(),
});

export const AdplErrorSchema = z.object({
  code: z.string(),
  category: z.string(),
  location: z.object({
    nodeId: z.string().optional(),
    field: z.string().optional(),
    line: z.number().optional(),
  }),
  message: z.string(),
  suggestion: z.string().optional(),
});

// NodeOutputAccessor.data: unknown (required) — z.unknown()은 required 필드 유지
export const NodeOutputAccessorSchema = z.object({
  status: NodeStatusSchema,
  data: z.unknown(),
  error: NodeErrorSchema.optional(),
  duration: z.number(),
  costUsd: z.number().optional(),
});
