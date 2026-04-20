import type { ExecutionPlan } from '../compiler/types';
import type { PipelineRunState } from '../state/types';
import type { NodeOutput } from '@/lib/adpl/types';
import type { CancellationToken } from '../cancel/token';

/**
 * Scheduler 가 호출하는 Worker 계약.
 * 실제 구현은 B5-2 에서 (RealWorker). 테스트는 MockWorker.
 */
export interface Worker {
  /**
   * 하나의 노드 실행.
   * throw 는 hard failure 로 간주. Worker 는 adapter 에러를 NodeOutput 으로
   * 변환해서 반환하는 것을 원칙.
   */
  execute(
    nodeId: string,
    plan: ExecutionPlan,
    state: PipelineRunState,
    token: CancellationToken,
  ): Promise<NodeOutput>;
}

export interface SchedulerResult {
  status: 'completed' | 'failed' | 'cancelled';
  completedNodes: number;
  failedNodes: number;
  skippedNodes: number;
  cancelledNodes: number;
  durationMs: number;
}

export interface SchedulerOptions {
  /** 기본 onError 정책. default: 'abort' */
  defaultOnError?: 'abort' | 'continue';
  debug?: boolean;
}
