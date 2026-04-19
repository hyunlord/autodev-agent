import type { NodeSpecBase } from '../common';
import type { Expression, Condition } from '../expression';
import type { NodeSpec } from './index';

export type LoopMode = 'forEach' | 'times' | 'while';

export interface LoopNodeSpec extends NodeSpecBase {
  type: 'loop';
  mode: LoopMode;

  // forEach 모드 필수
  over?: Expression; // 순회할 배열 (Slot 1)
  as?: string; // 현재 아이템 참조 이름 → $loop.<as>

  // times 모드 필수
  count?: number;

  // while 모드 필수
  condition?: Condition; // 반복 지속 조건 (post-test: do 실행 후 평가)
  maxIterations?: number; // while 시 필수 — 무한 루프 방지

  do: NodeSpec[]; // 재귀: 반복 실행할 노드 배열

  parallelism?: number; // default: 1 (동시 실행 iteration 수)
  continueOnIterFailure?: boolean; // default: false
  aggregateResults?: boolean; // default: true
  breakCondition?: Condition; // 조기 종료 조건
}
