import { z } from 'zod';
import { NodeSpecBaseSchema, RetryPolicySchema } from '../common';
import { ExpressionSchema } from '../expression';

export const AgentRoleSchema = z.enum([
  'planner',
  'coder',
  'verifier',
  'reviewer',
  'custom',
] as const);

export const OutputSpecSchema = z.object({
  schema: z.record(z.unknown()).optional(),
  parseAs: z.enum(['auto', 'json', 'text']).optional(),
  strict: z.boolean().optional(),
});

export const FallbackSpecSchema = z.object({
  model: z.string(),
  onErrors: z.array(z.string()).optional(),
  maxAttempts: z.number().int().positive().optional(),
});

export const ToolPolicySpecSchema = z.record(z.unknown());

export const AgentNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('agent'),
  role: AgentRoleSchema.optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
  systemPrompt: z.string().optional(),
  inputs: z.record(ExpressionSchema).optional(),
  output: OutputSpecSchema.optional(),
  useMemory: z.boolean().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  costLimit: z.number().positive().optional(),
  fallback: FallbackSpecSchema.optional(),
  toolPolicy: ToolPolicySpecSchema.optional(),
});
