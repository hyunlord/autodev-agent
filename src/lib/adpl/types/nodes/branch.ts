import type { NodeSpecBase } from '../common';
import type { Condition } from '../expression';
import type { NodeSpec } from './index';

export interface CaseSpec {
  // when 또는 default 중 하나 필수
  when?: Condition;
  default?: boolean; // true이면 else 분기
  then: NodeSpec[]; // 재귀: 이 case 실행 노드 배열
}

export interface BranchNodeSpec extends NodeSpecBase {
  type: 'branch';
  cases: CaseSpec[];
  evaluationMode?: 'first_match' | 'all_match'; // default: 'first_match'
  onMissingMatch?: 'skip' | 'error'; // default: 'skip'
}
