import { describe, it, expect } from 'vitest';
import { evaluateCondition, resolveField } from '../condition-evaluator';
import type { StructuredCondition } from '@/lib/adpl/types/expression';
import type { ExecutionContext } from '../../adapters/types';

function makeCtx(nodes: Record<string, unknown> = {}): ExecutionContext {
  return {
    $task: {} as ExecutionContext['$task'],
    $project: {} as ExecutionContext['$project'],
    $trigger: {} as ExecutionContext['$trigger'],
    $env: {},
    $now: new Date(),
    $self: {} as ExecutionContext['$self'],
    $nodes: nodes as ExecutionContext['$nodes'],
    $prev: null,
    $loop: null,
    $flow: null,
    $variables: {},
    worktreeRoot: '/',
  };
}

describe('evaluateCondition', () => {
  // ─────────────────────────────────────────────
  // 1. eq literal vs literal
  // ─────────────────────────────────────────────
  it('1. eq: literal matches same literal', () => {
    const cond: StructuredCondition = { field: '$nodes.step1.data', eq: 'hello' };
    const ctx = makeCtx({ step1: { data: 'hello' } });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  // ─────────────────────────────────────────────
  // 2. eq $nodes path vs literal — mock ctx 사용
  // ─────────────────────────────────────────────
  it('2. eq: $nodes path resolved from context', () => {
    const cond: StructuredCondition = { field: '$nodes.step1.data.score', eq: 80 };
    const ctx = makeCtx({ step1: { data: { score: 80 } } });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('2b. eq: $nodes path mismatch returns false', () => {
    const cond: StructuredCondition = { field: '$nodes.step1.data.score', eq: 80 };
    const ctx = makeCtx({ step1: { data: { score: 90 } } });
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  // ─────────────────────────────────────────────
  // 3. neq
  // ─────────────────────────────────────────────
  it('3. neq: different values returns true', () => {
    const cond: StructuredCondition = { field: '$nodes.s.val', neq: 'foo' };
    const ctx = makeCtx({ s: { val: 'bar' } });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('3b. neq: same value returns false', () => {
    const cond: StructuredCondition = { field: '$nodes.s.val', neq: 'foo' };
    const ctx = makeCtx({ s: { val: 'foo' } });
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  // ─────────────────────────────────────────────
  // 4. gt
  // ─────────────────────────────────────────────
  it('4. gt: 5 > 3 returns true', () => {
    const cond: StructuredCondition = { field: '$nodes.s.n', gt: 3 };
    const ctx = makeCtx({ s: { n: 5 } });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('4b. gt: 3 > 5 returns false', () => {
    const cond: StructuredCondition = { field: '$nodes.s.n', gt: 5 };
    const ctx = makeCtx({ s: { n: 3 } });
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  // ─────────────────────────────────────────────
  // 5. gte
  // ─────────────────────────────────────────────
  it('5. gte: 5 >= 5 returns true', () => {
    const cond: StructuredCondition = { field: '$nodes.s.n', gte: 5 };
    const ctx = makeCtx({ s: { n: 5 } });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('5b. gte: 4 >= 5 returns false', () => {
    const cond: StructuredCondition = { field: '$nodes.s.n', gte: 5 };
    const ctx = makeCtx({ s: { n: 4 } });
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  // ─────────────────────────────────────────────
  // 6. lt
  // ─────────────────────────────────────────────
  it('6. lt: 2 < 5 returns true', () => {
    const cond: StructuredCondition = { field: '$nodes.s.n', lt: 5 };
    const ctx = makeCtx({ s: { n: 2 } });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('6b. lt: 7 < 5 returns false', () => {
    const cond: StructuredCondition = { field: '$nodes.s.n', lt: 5 };
    const ctx = makeCtx({ s: { n: 7 } });
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  // ─────────────────────────────────────────────
  // 7. lte
  // ─────────────────────────────────────────────
  it('7. lte: 5 <= 5 returns true', () => {
    const cond: StructuredCondition = { field: '$nodes.s.n', lte: 5 };
    const ctx = makeCtx({ s: { n: 5 } });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('7b. lte: 6 <= 5 returns false', () => {
    const cond: StructuredCondition = { field: '$nodes.s.n', lte: 5 };
    const ctx = makeCtx({ s: { n: 6 } });
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  // ─────────────────────────────────────────────
  // 8. truthy null → false
  // ─────────────────────────────────────────────
  it('8. truthy: null field → false', () => {
    const cond: StructuredCondition = { field: '$nodes.s.val', truthy: true };
    const ctx = makeCtx({ s: { val: null } });
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  // ─────────────────────────────────────────────
  // 9. truthy string → true
  // ─────────────────────────────────────────────
  it('9. truthy: non-empty string → true', () => {
    const cond: StructuredCondition = { field: '$nodes.s.val', truthy: true };
    const ctx = makeCtx({ s: { val: 'hello' } });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  // ─────────────────────────────────────────────
  // 10. truthy 0 → false
  // ─────────────────────────────────────────────
  it('10. truthy: 0 → false', () => {
    const cond: StructuredCondition = { field: '$nodes.s.n', truthy: true };
    const ctx = makeCtx({ s: { n: 0 } });
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  // ─────────────────────────────────────────────
  // 11. all: both true → true
  // ─────────────────────────────────────────────
  it('11a. all: both conditions true → true', () => {
    const cond: StructuredCondition = {
      all: [
        { field: '$nodes.s.a', eq: 1 },
        { field: '$nodes.s.b', eq: 2 },
      ],
    };
    const ctx = makeCtx({ s: { a: 1, b: 2 } });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  // ─────────────────────────────────────────────
  // 12. all: one false → false
  // ─────────────────────────────────────────────
  it('11b. all: one condition false → false', () => {
    const cond: StructuredCondition = {
      all: [
        { field: '$nodes.s.a', eq: 1 },
        { field: '$nodes.s.b', eq: 99 },
      ],
    };
    const ctx = makeCtx({ s: { a: 1, b: 2 } });
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  // ─────────────────────────────────────────────
  // 13. any: one true → true
  // ─────────────────────────────────────────────
  it('12. any: one condition true → true', () => {
    const cond: StructuredCondition = {
      any: [
        { field: '$nodes.s.a', eq: 99 },
        { field: '$nodes.s.b', eq: 2 },
      ],
    };
    const ctx = makeCtx({ s: { a: 1, b: 2 } });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('12b. any: all false → false', () => {
    const cond: StructuredCondition = {
      any: [
        { field: '$nodes.s.a', eq: 99 },
        { field: '$nodes.s.b', eq: 88 },
      ],
    };
    const ctx = makeCtx({ s: { a: 1, b: 2 } });
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  // ─────────────────────────────────────────────
  // 14. not: true → false
  // ─────────────────────────────────────────────
  it('13. not: negates inner condition', () => {
    const cond: StructuredCondition = {
      not: { field: '$nodes.s.val', eq: 'hello' },
    };
    const ctx = makeCtx({ s: { val: 'hello' } });
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it('13b. not: negates false → true', () => {
    const cond: StructuredCondition = {
      not: { field: '$nodes.s.val', eq: 'hello' },
    };
    const ctx = makeCtx({ s: { val: 'world' } });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  // ─────────────────────────────────────────────
  // 15. FieldCondition with no operator → throw
  // ─────────────────────────────────────────────
  it('14. FieldCondition with no operator throws', () => {
    const cond = { field: '$nodes.s.val' } as StructuredCondition;
    const ctx = makeCtx({ s: { val: 'foo' } });
    expect(() => evaluateCondition(cond, ctx)).toThrow();
  });
});

describe('resolveField', () => {
  it('resolves $nodes.step.data path', () => {
    const ctx = makeCtx({ step: { data: 42 } });
    expect(resolveField('$nodes.step.data', ctx)).toBe(42);
  });

  it('returns undefined for missing path', () => {
    const ctx = makeCtx({});
    expect(resolveField('$nodes.missing.field', ctx)).toBeUndefined();
  });

  it('returns literal for non-$ prefix', () => {
    const ctx = makeCtx({});
    expect(resolveField('hello', ctx)).toBe('hello');
  });

  it('returns undefined for unknown root', () => {
    const ctx = makeCtx({});
    expect(resolveField('$unknown.field', ctx)).toBeUndefined();
  });
});
