import { describe, it, expect } from 'vitest';
import { evaluateCondition } from '../condition-evaluator';
import type { StructuredCondition } from '@/lib/adpl/types/expression';
import type { ExecutionContext } from '../../adapters/types';
import type { NodeOutput } from '@/lib/adpl/types';

function makeCtx(nodes: Record<string, unknown> = {}): ExecutionContext {
  return {
    $task: {} as ExecutionContext['$task'],
    $project: {} as ExecutionContext['$project'],
    $trigger: {} as ExecutionContext['$trigger'],
    $env: {},
    $now: new Date(),
    $self: {} as ExecutionContext['$self'],
    $nodes: nodes as Record<string, NodeOutput>,
    $prev: null,
    $loop: null,
    $flow: null,
    $variables: {},
    worktreeRoot: '/',
  };
}

describe('evaluateCondition — string routing (Stage 5 E2)', () => {
  // ─── 1. string condition → evaluateStringCondition 위임 ───────
  it('1. string condition: $nodes.X.data.score >= 80 evaluates correctly', () => {
    const ctx = makeCtx({ X: { status: 'success', data: { score: 85 } } });
    expect(evaluateCondition('$nodes.X.data.score >= 80', ctx)).toBe(true);
  });

  it('1b. string condition: score < threshold → false', () => {
    const ctx = makeCtx({ X: { status: 'success', data: { score: 70 } } });
    expect(evaluateCondition('$nodes.X.data.score >= 80', ctx)).toBe(false);
  });

  // ─── 2. string condition throw → 에러 전파 ───────────────────
  it('2. invalid string condition → EXPRESSION_UNSUPPORTED_TOKEN propagated', () => {
    const ctx = makeCtx({});
    expect(() => evaluateCondition('$x + 1 > 0', ctx)).toThrow('EXPRESSION_UNSUPPORTED_TOKEN');
  });

  it('2b. parse error propagated', () => {
    const ctx = makeCtx({});
    expect(() => evaluateCondition('($x', ctx)).toThrow();
  });

  // ─── 3. StructuredCondition 경로 여전히 작동 ─────────────────
  it('3. StructuredCondition eq path still works after routing change', () => {
    const cond: StructuredCondition = { field: '$nodes.a.val', eq: 42 };
    const ctx = makeCtx({ a: { val: 42 } });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('3b. StructuredCondition all combinator still works', () => {
    const cond: StructuredCondition = {
      all: [
        { field: '$nodes.a.ok', truthy: true },
        { field: '$nodes.b.score', gt: 80 },
      ],
    };
    const ctx = makeCtx({ a: { ok: true }, b: { score: 90 } });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  // ─── 4. truthy fallback 시나리오 ────────────────────────────
  it('4. string condition: undefined path → NaN comparison → false (no throw)', () => {
    const ctx = makeCtx({}); // $nodes.missing does not exist
    // Should return false, not throw
    expect(evaluateCondition('$nodes.missing.score >= 80', ctx)).toBe(false);
  });

  it('4b. string condition: complex && with $loop context', () => {
    const ctx: ExecutionContext = {
      $task: {} as ExecutionContext['$task'],
      $project: {} as ExecutionContext['$project'],
      $trigger: {} as ExecutionContext['$trigger'],
      $env: {},
      $now: new Date(),
      $self: {} as ExecutionContext['$self'],
      $nodes: {} as Record<string, NodeOutput>,
      $prev: null,
      $loop: { index: 2, total: 5, isFirst: false, isLast: false },
      $flow: null,
      $variables: {},
      worktreeRoot: '/',
    };
    expect(evaluateCondition('$loop.index >= 2', ctx)).toBe(true);
  });
});
