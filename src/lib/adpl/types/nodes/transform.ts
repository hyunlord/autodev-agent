import type { NodeSpecBase } from '../common';
import type { Expression, Condition } from '../expression';

export type TransformOperation = 'filter' | 'map' | 'pluck';

// filter: 조건에 맞는 요소만 남김
export interface FilterParams {
  where: Condition;
}

// map: 각 요소를 새 구조로 변환 (template 안 ${item.*} 표현식 사용)
export interface MapParams {
  template: Record<string, Expression>;
}

// pluck: 각 요소에서 특정 필드만 추출
export interface PluckParams {
  field: string;
}

export type TransformParams = FilterParams | MapParams | PluckParams;

export interface TransformNodeSpec extends NodeSpecBase {
  type: 'transform';
  input: Expression; // 변환할 배열 (Slot 1)
  operation: TransformOperation;
  params: TransformParams;
}
