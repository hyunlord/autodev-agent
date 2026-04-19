import { z } from 'zod';
import type { TriggerSpec } from '../../types/triggers/index';
import { TaskCreatedTriggerSchema } from './task-created';
import { ManualTriggerSchema } from './manual';
import { ScheduleTriggerSchema } from './schedule';
import { WebhookInTriggerSchema } from './webhook-in';
import { GitEventTriggerSchema } from './git-event';

export const TriggerSpecSchema: z.ZodType<TriggerSpec> = z.discriminatedUnion('type', [
  TaskCreatedTriggerSchema,
  ManualTriggerSchema,
  ScheduleTriggerSchema,
  WebhookInTriggerSchema,
  GitEventTriggerSchema,
]);

export { TaskCreatedTriggerSchema } from './task-created';
export { ManualTriggerSchema, InputFieldSchema, InputFieldTypeSchema } from './manual';
export { ScheduleTriggerSchema, ScheduleModeSchema, OverlapModeSchema } from './schedule';
export { WebhookInTriggerSchema, WebhookAuthSchema, WebhookResponseModeSchema } from './webhook-in';
export {
  GitEventTriggerSchema,
  GitEventTypeSchema,
  WebhookConfigSchema,
  GitFilterSchema,
} from './git-event';
