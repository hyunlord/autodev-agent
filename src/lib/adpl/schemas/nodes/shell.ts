import { z } from 'zod';
import { NodeSpecBaseSchema } from '../common';

export const ShellOutputFormatSchema = z.enum([
  'auto',
  'text',
  'json',
  'lines',
  'binary',
] as const);

export const ShellModeSchema = z.enum(['shell', 'exec'] as const);

export const ShellNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('shell'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  mode: ShellModeSchema.optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  stdin: z.string().optional(),
  outputFormat: ShellOutputFormatSchema.optional(),
  failOnNonZero: z.boolean().optional(),
  allowExitCodes: z.array(z.number().int()).optional(),
  idempotencyKey: z.string().optional(),
  useIsolatedWorktree: z.boolean().optional(),
});
