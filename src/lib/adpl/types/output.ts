import type { NodeStatus } from './common';

export type ErrorCategory =
  | 'transient'
  | 'persistent'
  | 'quality'
  | 'cost_limit'
  | 'cancellation'
  | 'policy_violation'
  | 'timeout';

export type AdplErrorCode = string; // ERR_TRANSIENT, ERR_PERSISTENT, ...

export interface NodeError {
  code: AdplErrorCode;
  message: string;
  category: ErrorCategory;
  details?: unknown;
}

export interface NodeMetrics {
  durationMs: number;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface NodeOutput {
  status: NodeStatus;
  data?: unknown; // 노드 타입별 상이
  error?: NodeError;
  metrics?: NodeMetrics;
}

// §5.4 에러 메시지 포맷
export interface AdplError {
  code: string;
  category: string;
  location: {
    nodeId?: string;
    field?: string;
    line?: number;
  };
  message: string;
  suggestion?: string;
}

// §3.3 $nodes.<id>.output 구조
export interface NodeOutputAccessor {
  status: NodeStatus;
  data: unknown;
  error?: NodeError;
  duration: number; // ms
  costUsd?: number;
}
