import type { Condition } from '../expression';

export type WebhookAuth = 'none' | 'header' | 'hmac' | 'basic';
export type WebhookResponseMode = 'immediate' | 'sync';

export interface WebhookInTrigger {
  id?: string;
  type: 'webhook_in';
  enabled?: boolean; // default: true
  path: string; // 엔드포인트 경로 suffix
  method?: 'POST' | 'GET'; // default: 'POST'
  auth?: WebhookAuth; // default: 'none'
  secret?: string; // auth != 'none' 시 필수. ${$env.X} 권장
  responseMode?: WebhookResponseMode; // default: 'immediate'
  rateLimitPerMinute?: number; // default: 60
  filter?: Condition;
}
