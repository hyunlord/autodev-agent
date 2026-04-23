import { describe, it, expect } from 'vitest';
import { tokenize } from '../tokenizer';
import { parse } from '../parser';
import type { Ast } from '../parser';

function p(expr: string): Ast {
  return parse(tokenize(expr));
}

describe('parser', () => {
  // ─── 1. 단순 비교 ─────────────────────────────────────────
  it('1. $nodes.X > 80 → binary gt', () => {
    const ast = p('$nodes.X > 80');
    expect(ast).toEqual<Ast>({
      kind: 'binary',
      op: '>',
      left: { kind: 'path', value: '$nodes.X' },
      right: { kind: 'number', value: 80 },
    });
  });

  it('1b. $nodes.X >= 0.8 → binary gte', () => {
    const ast = p('$nodes.X >= 0.8');
    expect(ast).toMatchObject({ kind: 'binary', op: '>=' });
  });

  // ─── 2. 논리 && ────────────────────────────────────────────
  it('2. $a && $b → binary and', () => {
    const ast = p('$a && $b');
    expect(ast).toEqual<Ast>({
      kind: 'binary',
      op: '&&',
      left: { kind: 'path', value: '$a' },
      right: { kind: 'path', value: '$b' },
    });
  });

  // ─── 3. 우선순위: && before || ────────────────────────────
  it('3. $a && $b || $c → ($a && $b) || $c (left-associative)', () => {
    const ast = p('$a && $b || $c');
    // || is lower precedence: (($a && $b) || $c)
    expect(ast.kind).toBe('binary');
    const bin = ast as Extract<Ast, { kind: 'binary' }>;
    expect(bin.op).toBe('||');
    expect(bin.left).toMatchObject({ kind: 'binary', op: '&&' });
    expect(bin.right).toMatchObject({ kind: 'path', value: '$c' });
  });

  // ─── 4. 괄호로 우선순위 변경 ────────────────────────────
  it('4. ($a || $b) && $c → changes precedence', () => {
    const ast = p('($a || $b) && $c');
    const bin = ast as Extract<Ast, { kind: 'binary' }>;
    expect(bin.op).toBe('&&');
    expect(bin.left).toMatchObject({ kind: 'binary', op: '||' });
    expect(bin.right).toMatchObject({ kind: 'path', value: '$c' });
  });

  // ─── 5. 단항 ! ──────────────────────────────────────────
  it('5. !$a → unary not', () => {
    const ast = p('!$a');
    expect(ast).toEqual<Ast>({
      kind: 'unary',
      op: '!',
      operand: { kind: 'path', value: '$a' },
    });
  });

  // ─── 6. 중첩 단항 ───────────────────────────────────────
  it('6. !($a && $b) → unary of binary', () => {
    const ast = p('!($a && $b)');
    expect(ast.kind).toBe('unary');
    const u = ast as Extract<Ast, { kind: 'unary' }>;
    expect(u.op).toBe('!');
    expect(u.operand).toMatchObject({ kind: 'binary', op: '&&' });
  });

  // ─── 7. 닫히지 않은 괄호 → 에러 ────────────────────────
  it('7. unclosed paren → EXPRESSION_PARSE_ERROR', () => {
    expect(() => p('($a')).toThrow('EXPRESSION_PARSE_ERROR');
  });

  // ─── 8. 연속 연산자 → 에러 ───────────────────────────────
  it('8. consecutive operators ($a > > $b) → EXPRESSION_PARSE_ERROR', () => {
    expect(() => p('$a > > $b')).toThrow('EXPRESSION_PARSE_ERROR');
  });

  // ─── 9. 리터럴 파싱 ───────────────────────────────────────
  it('9. null literal', () => {
    expect(p('null')).toEqual<Ast>({ kind: 'null' });
  });

  it('9b. bool literal', () => {
    expect(p('true')).toEqual<Ast>({ kind: 'bool', value: true });
  });

  it('9c. string literal', () => {
    expect(p('"hello"')).toEqual<Ast>({ kind: 'string', value: 'hello' });
  });

  // ─── 10. 복합 표현식 파싱 ────────────────────────────────
  it('10. $a >= 80 && $b === true → binary(&&, binary(>=), binary(===))', () => {
    const ast = p('$a >= 80 && $b === true');
    expect(ast.kind).toBe('binary');
    const top = ast as Extract<Ast, { kind: 'binary' }>;
    expect(top.op).toBe('&&');
    expect(top.left).toMatchObject({ kind: 'binary', op: '>=' });
    expect(top.right).toMatchObject({ kind: 'binary', op: '===' });
  });
});
