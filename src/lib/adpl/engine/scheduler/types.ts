import type { ExecutionPlan } from '../compiler/types';
import type { PipelineRunState } from '../state/types';
import type { NodeOutput } from '@/lib/adpl/types';
import type { CancellationToken } from '../cancel/token';
import type { FlowRegistry } from './flow-registry';

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
  /** Flow node handler registry. default: parallelHandler 포함 기본 registry */
  flowRegistry?: FlowRegistry;
  /**
   * Stage 6 F3 — Resume mode. Fresh run (default, false) 은 root 노드들만 ready queue 에 시드.
   * Resume (true) 는 이미 state 에 부분 진행이 있으므로, pending 이면서 모든 prereq 가 이미 완료된
   * 모든 노드를 ready queue 에 시드. completed / failed 노드는 그대로 보존.
   */
  resumeMode?: boolean;
}
