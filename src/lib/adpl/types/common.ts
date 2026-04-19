export type NodeId = string;
export type ISOTimestamp = string;

export type FailurePolicy = 'abort' | 'continue' | 'retry';

export type NodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'waiting'; // gate 대기 상태

export interface RetryPolicy {
  maxAttempts: number; // 최대 시도 횟수 (초기 실행 포함), default: 1
  backoff?: 'linear' | 'exponential' | 'fixed';
  initialDelay?: number; // 첫 재시도 대기 시간 (초)
  maxDelay?: number; // 최대 대기 시간 (초)
}

export interface NodeSpecBase {
  id: NodeId;
  type: string;
  name?: string;
  description?: string;
  when?: import('./expression').Condition;
  onFailure?: FailurePolicy;
  timeout?: number; // 초, default: settings.nodeTimeout
  retryPolicy?: RetryPolicy;
  dependsOn?: string[];
}
