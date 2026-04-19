import type { TaskCreatedTrigger } from './task-created';
import type { ManualTrigger } from './manual';
import type { ScheduleTrigger } from './schedule';
import type { WebhookInTrigger } from './webhook-in';
import type { GitEventTrigger } from './git-event';

export type TriggerSpec =
  | TaskCreatedTrigger
  | ManualTrigger
  | ScheduleTrigger
  | WebhookInTrigger
  | GitEventTrigger;

export type { TaskCreatedTrigger } from './task-created';
export type { ManualTrigger, InputField, InputFieldType } from './manual';
export type { ScheduleTrigger, ScheduleMode, OverlapMode } from './schedule';
export type { WebhookInTrigger, WebhookAuth, WebhookResponseMode } from './webhook-in';
export type { GitEventTrigger, GitEventType, WebhookConfig, GitFilter } from './git-event';
