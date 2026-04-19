import type { FailurePolicy, RetryPolicy } from './common';
import type { NodeSpec } from './nodes/index';
import type { TriggerSpec } from './triggers/index';

export interface PipelineSettings {
  maxParallel?: number; // default: 5, 범위: 1-20
  totalTimeout?: number; // default: 7200초, 범위: 1-86400
  nodeTimeout?: number; // default: 600초, 범위: 1-3600
  onNodeFailure?: FailurePolicy; // default: 'abort'
  totalCostLimit?: number | null; // USD, default: null
  retryPolicy?: RetryPolicy | null; // 파이프라인 기본 재시도 정책
  allowedEnvKeys?: string[]; // $env 접근 허용 환경 변수 키 목록
}

export interface AdplPipeline {
  adplVersion: 1; // ADPL Major 버전. v1.0에서 유일한 허용 값
  name: string; // /^[a-z0-9][a-z0-9\-]{0,62}$/ , 프로젝트 내 unique
  description?: string; // 최대 500자
  triggers?: TriggerSpec[]; // default: [{ type: 'manual' }]
  pipeline: NodeSpec[]; // 최소 1개 필수
  settings?: PipelineSettings;
  metadata?: Record<string, unknown>; // 표현식 미지원 (정적 값만)
}
