import type { EventBus } from '../events/bus';
import type { CancellationToken } from '../cancel/token';
import type { NodeOutput } from '@/lib/adpl/types';

/**
 * runSubNode: sub-node 를 pathId 로 실행하고 NodeOutput 반환.
 * Scheduler 가 주입하는 콜백 — 상태 전이(pending→ready→running→terminal) + 이벤트 emit 포함.
 */
export type RunSubNodeFn = (pathId: string) => Promise<NodeOutput>;

export interface FlowNodeOptions {
  runId: string;
  eventBus: EventBus;
  token: CancellationToken;
}

/**
 * FlowNodeHandler — NodeAdapter 와 완전히 별개.
 * Scheduler 내 전용 FlowRegistry 에 등록. AdapterRegistry 에 섞어넣지 않음.
 * "실행체"가 아닌 "스케줄러" — sub-node 실행을 조율.
 */
export interface FlowNodeHandler<TSpec = unknown> {
  readonly type: string;
  handle(
    spec: TSpec,
    nodePathId: string,
    runSubNode: RunSubNodeFn,
    options: FlowNodeOptions,
  ): Promise<NodeOutput>;
}
