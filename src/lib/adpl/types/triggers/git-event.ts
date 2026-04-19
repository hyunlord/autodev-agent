import type { Condition } from '../expression';

export type GitEventType =
  | 'pr_opened'
  | 'pr_updated'
  | 'pr_merged'
  | 'pr_closed'
  | 'push'
  | 'tag_created'
  | 'tag_deleted';

export interface WebhookConfig {
  provider: 'github' | 'gitlab';
  secret: string; // ${$env.X} 권장
}

export interface GitFilter {
  branches?: string[]; // glob 패턴
  paths?: string[]; // 변경된 파일 경로 (push/pr)
  prLabels?: string[]; // PR 레이블 필터
  ignorePaths?: string[]; // 제외할 경로
}

export interface GitEventTrigger {
  id?: string;
  type: 'git_event';
  enabled?: boolean; // default: true
  source?: 'webhook' | 'poll'; // default: 'webhook'
  webhookConfig?: WebhookConfig; // source: 'webhook' 시 필수
  events: GitEventType[];
  filter?: GitFilter | Condition;
}
