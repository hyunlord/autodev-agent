import type { NodeSpecBase, RetryPolicy } from '../common';

export type WebhookOutProvider = 'slack' | 'discord' | 'teams' | 'generic';

export interface WebhookOutNodeSpec extends NodeSpecBase {
  type: 'webhook_out';
  provider?: WebhookOutProvider; // default: 'generic'
  url: string; // Slot 1 표현식 가능
  body: Record<string, unknown>; // provider별 스키마
  silentFail?: boolean; // default: true — 실패 시 파이프라인 계속
  failOnError?: boolean; // default: false
  rateLimitPerMinute?: number; // provider별 기본값
  retryPolicy?: RetryPolicy; // default: 1회 재시도
}
