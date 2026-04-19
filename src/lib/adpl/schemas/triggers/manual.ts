import { z } from 'zod';

export const InputFieldTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'select',
] as const);

export const InputFieldSchema = z.object({
  name: z.string(),
  type: InputFieldTypeSchema,
  label: z.string().optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  options: z.array(z.string()).optional(),
});

export const ManualTriggerSchema = z.object({
  id: z.string().optional(),
  type: z.literal('manual'),
  enabled: z.boolean().optional(),
  inputSchema: z.array(InputFieldSchema).optional(),
  confirmMessage: z.string().optional(),
});
