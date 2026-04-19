export type ScheduleMode = 'cron' | 'interval' | 'once';
export type OverlapMode = 'skip' | 'queue' | 'concurrent';

export interface ScheduleTrigger {
  id?: string;
  type: 'schedule';
  enabled?: boolean; // default: true
  mode: ScheduleMode;

  // cron 모드 필수
  cron?: string; // 5-field cron 표현식

  // interval 모드 필수
  interval?: number; // 실행 간격 (초)

  // once 모드 필수
  at?: string; // ISO 8601 일시

  timezone?: string; // default: 'UTC' (IANA timezone)
  overlap?: OverlapMode; // default: 'skip'
  validFrom?: string; // ISO 8601
  validUntil?: string; // ISO 8601
  maxRuns?: number; // 최대 실행 횟수
}
