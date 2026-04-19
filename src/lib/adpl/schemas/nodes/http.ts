import { z } from 'zod';
import { NodeSpecBaseSchema, RetryPolicySchema } from '../common';

export const HttpMethodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const);

export const BodyFormatSchema = z.enum([
  'json',
  'form',
  'text',
  'binary',
  'multipart',
] as const);

// RetryPolicySchema가 구체적 ZodObject이므로 .extend() 가능
export const HttpRetryPolicySchema = RetryPolicySchema.extend({
  onStatuses: z.array(z.number().int()).optional(),
});

export const HttpNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('http'),
  url: z.string(),
  method: HttpMethodSchema.optional(),
  headers: z.record(z.string()).optional(),
  queryParams: z.record(z.string()).optional(),
  bodyFormat: BodyFormatSchema.optional(),
  body: z.unknown().optional(),
  allowedHosts: z.array(z.string()).optional(),
  idempotencyKey: z.string().optional(),
  retryPolicy: HttpRetryPolicySchema.optional(),
});
