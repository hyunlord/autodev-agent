import type { StructuredCondition, FieldCondition, Condition } from '@/lib/adpl/types/expression';
import type { ExecutionContext } from '../adapters/types';
import { evaluateStringCondition } from './expression';

/**
 * Condition 평가기 (Stage 5 E2 이후).
 * - string → evaluateStringCondition (mini-evaluator)
 * - StructuredCondition → 기존 로직
 */
export function evaluateCondition(
  condition: Condition,
  ctx: ExecutionContext,
): boolean {
  if (typeof condition === 'string') {
    return evaluateStringCondition(condition, ctx);
  }
  if ('all' in condition) {
    return condition.all.every((c) => evaluateCondition(c, ctx));
  }
  if ('any' in condition) {
    return condition.any.some((c) => evaluateCondition(c, ctx));
  }
  if ('not' in condition) {
    return !evaluateCondition(condition.not, ctx);
  }
  // FieldCondition
  return evaluateFieldCondition(condition as FieldCondition, ctx);
}

/**
 * FieldCondition 평가.
 * field 에 명시된 경로를 context 에서 resolve 한 뒤 연산자별 비교.
 */
function evaluateFieldCondition(fc: FieldCondition, ctx: ExecutionContext): boolean {
  let value = resolveField(fc.field, ctx);

  // 변환 적용
  if (fc.transform) {
    if (fc.transform === 'lower' && typeof value === 'string') {
      value = value.toLowerCase();
    } else if (fc.transform === 'upper' && typeof value === 'string') {
      value = value.toUpperCase();
    } else if (fc.transform === 'length') {
      if (typeof value === 'string' || Array.isArray(value)) {
        value = value.length;
      } else {
        value = 0;
      }
    }
  }

  // 연산자 평가 (정의된 연산자 중 하나라도 있으면 적용)
  if ('eq' in fc && fc.eq !== undefined) {
    return deepEqual(value, fc.eq);
  }
  if ('neq' in fc && fc.neq !== undefined) {
    return !deepEqual(value, fc.neq);
  }
  if ('gt' in fc && fc.gt !== undefined) {
    return toNumber(value) > toNumber(fc.gt);
  }
  if ('gte' in fc && fc.gte !== undefined) {
    return toNumber(value) >= toNumber(fc.gte);
  }
  if ('lt' in fc && fc.lt !== undefined) {
    return toNumber(value) < toNumber(fc.lt);
  }
  if ('lte' in fc && fc.lte !== undefined) {
    return toNumber(value) <= toNumber(fc.lte);
  }
  if ('in' in fc && fc.in !== undefined) {
    return fc.in.some((item) => deepEqual(value, item));
  }
  if ('nin' in fc && fc.nin !== undefined) {
    return !fc.nin.some((item) => deepEqual(value, item));
  }
  if ('contains' in fc && fc.contains !== undefined) {
    if (typeof value === 'string' && typeof fc.contains === 'string') {
      return value.includes(fc.contains);
    }
    if (Array.isArray(value)) {
      return value.some((item) => deepEqual(item, fc.contains));
    }
    return false;
  }
  if ('startsWith' in fc && fc.startsWith !== undefined) {
    return typeof value === 'string' && value.startsWith(fc.startsWith);
  }
  if ('endsWith' in fc && fc.endsWith !== undefined) {
    return typeof value === 'string' && value.endsWith(fc.endsWith);
  }
  if ('matches' in fc && fc.matches !== undefined) {
    return typeof value === 'string' && new RegExp(fc.matches).test(value);
  }
  if ('exists' in fc && fc.exists !== undefined) {
    const fieldExists = value !== null && value !== undefined;
    return fc.exists ? fieldExists : !fieldExists;
  }
  if ('empty' in fc && fc.empty !== undefined) {
    const isEmpty = isEmptyValue(value);
    return fc.empty ? isEmpty : !isEmpty;
  }
  if ('truthy' in fc && fc.truthy !== undefined) {
    const isTruthy = Boolean(value);
    return fc.truthy ? isTruthy : !isTruthy;
  }

  throw new Error(`[ConditionEvaluator] FieldCondition has no operator: ${JSON.stringify(fc)}`);
}

/**
 * $ 경로 문자열을 ExecutionContext 에서 resolve.
 * $nodes.stepId.data.field 형태의 dot-access 지원.
 */
export function resolveField(field: string, ctx: ExecutionContext): unknown {
  if (!field.startsWith('$')) {
    return field; // 리터럴
  }

  const parts = field.split('.');
  // parts[0] = '$nodes' or '$prev' etc.
  const root = parts[0];

  let current: unknown;
  switch (root) {
    case '$nodes':
      current = ctx.$nodes;
      break;
    case '$prev':
      current = ctx.$prev;
      break;
    case '$loop':
      current = ctx.$loop;
      break;
    case '$flow':
      current = ctx.$flow;
      break;
    case '$env':
      current = ctx.$env;
      break;
    case '$variables':
      current = ctx.$variables;
      break;
    case '$trigger':
      current = ctx.$trigger;
      break;
    case '$task':
      current = ctx.$task;
      break;
    case '$project':
      current = ctx.$project;
      break;
    default:
      return undefined;
  }

  // 나머지 path segments 순차 탐색
  for (let i = 1; i < parts.length; i++) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[parts[i]];
    } else {
      return undefined;
    }
  }

  return current;
}

function toNumber(v: unknown): number {
  const n = Number(v);
  if (Number.isNaN(n)) {
    throw new Error(`[ConditionEvaluator] Cannot convert ${JSON.stringify(v)} to number`);
  }
  return n;
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
