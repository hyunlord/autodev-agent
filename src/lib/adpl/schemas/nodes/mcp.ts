import { z } from 'zod';
import { NodeSpecBaseSchema, RetryPolicySchema } from '../common';

export const McpSessionModeSchema = z.enum(['per_task', 'shared', 'per_node'] as const);

export const McpNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('mcp'),
  server: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()).optional(),
  sessionMode: McpSessionModeSchema.optional(),
  argsValidation: z.boolean().optional(),
  retryPolicy: RetryPolicySchema.optional(),
});
