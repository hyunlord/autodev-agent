import type { NodeSpecBase, RetryPolicy } from '../common';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type BodyFormat = 'json' | 'form' | 'text' | 'binary' | 'multipart';

// HTTP 재시도 정책: 기본 RetryPolicy + HTTP 상태 코드 필터
export interface HttpRetryPolicy extends RetryPolicy {
  onStatuses?: number[]; // default: [429, 502, 503, 504]
}

export interface HttpNodeSpec extends NodeSpecBase {
  type: 'http';
  url: string; // Slot 1 표현식 가능
  method?: HttpMethod; // default: 'GET'
  headers?: Record<string, string>; // 값에 Slot 1 가능
  queryParams?: Record<string, string>; // 자동 URL 인코딩
  bodyFormat?: BodyFormat; // default: 'json'
  body?: unknown; // Slot 1 표현식 가능
  allowedHosts?: string[]; // 보안: 허용 호스트 목록
  idempotencyKey?: string; // Slot 1 가능. POST retry 안전성 보장
  retryPolicy?: HttpRetryPolicy;
}
