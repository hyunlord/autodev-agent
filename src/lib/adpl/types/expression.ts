// Slot 1: 보간 문자열 "${...}" 형태. 런타임 파싱은 A2-2 Zod에서.
export type Expression = string;

// Slot 2: 구조화 조건 — YAML/JSON 객체 또는 문자열 표현식
export type Condition = StructuredCondition | string;

export type StructuredCondition =
  | AllCondition
  | AnyCondition
  | NotCondition
  | FieldCondition;

export interface AllCondition {
  all: StructuredCondition[];
}

export interface AnyCondition {
  any: StructuredCondition[];
}

export interface NotCondition {
  not: StructuredCondition;
}

// 단일 필드 조건
export interface FieldCondition {
  field: string;
  transform?: 'lower' | 'upper' | 'length';
  // §4.2 15개 연산자
  eq?: unknown;
  neq?: unknown;
  lt?: number | string;
  lte?: number | string;
  gt?: number | string;
  gte?: number | string;
  in?: unknown[];
  nin?: unknown[];
  contains?: unknown;
  startsWith?: string;
  endsWith?: string;
  matches?: string; // regex
  exists?: boolean;
  empty?: boolean;
  truthy?: boolean;
}
