import { describe, it, expect } from 'vitest';
import { tokenize } from '../tokenizer';
import { parse } from '../parser';
import { evaluate, isTruthy } from '../evaluator';
import type { ExecutionContext } from '../../../adapters/types';
import type { NodeOutput } from '@/lib/adpl/types';

function makeCtx(nodes: Record<string, unknown> = {}): ExecutionContext {
  return {
    $task: {} as ExecutionContext['$task'],
    $project: {} as ExecutionContext['$project'],
    $trigger: { kind: 'task_created' } as unknown as ExecutionContext['$trigger'],
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

function ev(expr: string, nodes: Record<string, unknown> = {}): unknown {
  return evaluate(parse(tokenize(expr)), makeCtx(nodes));
}

describe('evaluator', () => {
  // ─── 1. 숫자 리터럴 비교 ────────────────────────────────────
  it('1. 80 > 50 → true', () => {
    expect(ev('80 > 50')).toBe(true);
  });

  it('1b. 50 > 80 → false', () => {
    expect(ev('50 > 80')).toBe(false);
  });

  // ─── 2. $nodes 경로 resolve ──────────────────────────────────
  it('2. $nodes.plan.data.confidence >= 0.8 → true (0.9)', () => {
    const nodes = { plan: { status: 'success', data: { confidence: 0.9 } } };
    expect(ev('$nodes.plan.data.confidence >= 0.8', nodes)).toBe(true);
  });

  it('2b. $nodes.plan.data.confidence >= 0.8 → false (0.5)', () => {
    const nodes = { plan: { status: 'success', data: { confidence: 0.5 } } };
    expect(ev('$nodes.plan.data.confidence >= 0.8', nodes)).toBe(false);
  });

  // ─── 3. == 같은 값 ──────────────────────────────────────────
  it('3. $nodes.a.val == $nodes.b.val → true (same value)', () => {
    const nodes = { a: { val: 42 }, b: { val: 42 } };
    expect(ev('$nodes.a.val == $nodes.b.val', nodes)).toBe(true);
  });

  // ─── 4. 단항 !  ─────────────────────────────────────────────
  it('4. !true → false', () => {
    expect(ev('!true')).toBe(false);
  });

  it('4b. !false → true', () => {
    expect(ev('!false')).toBe(true);
  });

  it('4c. !$nodes.x.val → false when val is truthy (1)', () => {
    expect(ev('!$nodes.x.val', { x: { val: 1 } })).toBe(false);
  });

  // ─── 5. && short-circuit ──────────────────────────────────────
  it('5. && short-circuit: left false → returns false (right not evaluated)', () => {
    // $nodes.a.ok = false → short-circuit, right side ($nodes.missing.x >= 1) not reached
    // Without short-circuit it would still return false, but right eval is skipped
    const nodes = { a: { ok: false } };
    expect(ev('$nodes.a.ok && $nodes.missing.x >= 1', nodes)).toBe(false);
  });

  it('5b. && both sides evaluated when left is true', () => {
    const nodes = { a: { ok: true }, b: { score: 90 } };
    expect(ev('$nodes.a.ok && $nodes.b.score > 80', nodes)).toBe(true);
  });

  // ─── 6. || short-circuit ──────────────────────────────────────
  it('6. || short-circuit: left true → returns true (right not evaluated)', () => {
    const nodes = { a: { ok: true } };
    expect(ev('$nodes.a.ok || $nodes.missing.x >= 1', nodes)).toBe(true);
  });

  it('6b. || both sides evaluated when left is false', () => {
    const nodes = { a: { ok: false }, b: { score: 90 } };
    expect(ev('$nodes.a.ok || $nodes.b.score > 80', nodes)).toBe(true);
  });

  // ─── 7. 누락 경로 → NaN 비교 → false ──────────────────────────
  it('7. $nodes.missing.path >= 0.5 → false (NaN comparison)', () => {
    // undefined resolved → NaN, NaN >= 0.5 = false
    expect(ev('$nodes.missing.path >= 0.5', {})).toBe(false);
  });

  it('7b. $nodes.x.y.z >= 0 with x existing but y missing → false', () => {
    expect(ev('$nodes.x.y.z >= 0', { x: {} })).toBe(false);
  });

  // ─── 8. 문자열 비교 ──────────────────────────────────────────
  it("8. 'a' == 'a' → true", () => {
    expect(ev("'a' == 'a'")).toBe(true);
  });

  it("8b. 'a' == 'b' → false", () => {
    expect(ev("'a' == 'b'")).toBe(false);
  });

  // ─── 9. null 비교 ──────────────────────────────────────────
  it('9. $nodes.x.val == null → true when val is null', () => {
    const nodes = { x: { val: null } };
    expect(ev('$nodes.x.val == null', nodes)).toBe(true);
  });

  it('9b. $nodes.x.val == null → false when val is 1', () => {
    const nodes = { x: { val: 1 } };
    expect(ev('$nodes.x.val == null', nodes)).toBe(false);
  });

  // ─── 10. 중첩 복합 ─────────────────────────────────────────
  it('10. !($nodes.a.x > 0 && $nodes.b.y < 10) → true when inner is false', () => {
    const nodes = { a: { x: -1 }, b: { y: 5 } };
    // a.x > 0 = false → && = false → ! = true
    expect(ev('!($nodes.a.x > 0 && $nodes.b.y < 10)', nodes)).toBe(true);
  });

  it('10b. !($nodes.a.x > 0 && $nodes.b.y < 10) → false when inner is true', () => {
    const nodes = { a: { x: 5 }, b: { y: 5 } };
    // 5 > 0 = true, 5 < 10 = true → && = true → ! = false
    expect(ev('!($nodes.a.x > 0 && $nodes.b.y < 10)', nodes)).toBe(false);
  });

  // ─── 11. isTruthy helper ────────────────────────────────────
  it('11. isTruthy: 0 → false, 1 → true, "" → false, "x" → true', () => {
    expect(isTruthy(0)).toBe(false);
    expect(isTruthy(1)).toBe(true);
    expect(isTruthy('')).toBe(false);
    expect(isTruthy('x')).toBe(true);
    expect(isTruthy(null)).toBe(false);
    expect(isTruthy(undefined)).toBe(false);
  });

  // ─── 12. === strict equality ─────────────────────────────────
  it('12. 1 === 1 → true, 1 === "1" → false', () => {
    expect(ev('1 === 1')).toBe(true);
    expect(ev("1 === '1'")).toBe(false);
  });

  // ─── 13. !== strict inequality ───────────────────────────────
  it('13. 1 !== 2 → true, 1 !== 1 → false', () => {
    expect(ev('1 !== 2')).toBe(true);
    expect(ev('1 !== 1')).toBe(false);
  });

  // ─── 14. $trigger context ────────────────────────────────────
  it('14. $trigger.kind === "task_created" → true', () => {
    expect(ev('$trigger.kind === "task_created"')).toBe(true);
  });
});
