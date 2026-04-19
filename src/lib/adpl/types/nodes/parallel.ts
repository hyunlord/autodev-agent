import type { NodeSpecBase } from '../common';
import type { NodeSpec } from './index';

export type MergeStrategy = 'all_must_pass' | 'any_succeeds' | 'majority' | 'best_score';

export interface ParallelBranchSpec {
  id: string;
  nodes: NodeSpec[]; // 재귀: 이 branch 내 순차 실행 노드
}

export interface ParallelNodeSpec extends NodeSpecBase {
  type: 'parallel';
  branches: ParallelBranchSpec[];
  mergeStrategy?: MergeStrategy; // default: 'all_must_pass'
  maxConcurrent?: number; // default: settings.maxParallel
  onError?: 'abort_all' | 'continue'; // default: 'abort_all'
  cancelOnFirstFailure?: boolean; // default: false
}
