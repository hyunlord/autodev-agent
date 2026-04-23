import { describe, it, expect } from 'vitest';
import { tokenize } from '../tokenizer';
import type { Token } from '../tokenizer';

describe('tokenizer', () => {
  // ─── 1. 숫자 토큰 ──────────────────────────────────────────
  it('1a. integer: 80', () => {
    const t = tokenize('80');
    expect(t).toEqual<Token[]>([{ kind: 'number', value: 80 }]);
  });

  it('1b. float: 0.8', () => {
    expect(tokenize('0.8')).toEqual<Token[]>([{ kind: 'number', value: 0.8 }]);
  });

  it('1c. negative: -1', () => {
    expect(tokenize('-1')).toEqual<Token[]>([{ kind: 'number', value: -1 }]);
  });

  it('1d. scientific: 1e3', () => {
    expect(tokenize('1e3')).toEqual<Token[]>([{ kind: 'number', value: 1000 }]);
  });

  it('1e. negative scientific: 1.5e-2 (within number)', () => {
    // 1.5e-2 → 0.015
    expect(tokenize('1.5e-2')).toEqual<Token[]>([{ kind: 'number', value: 0.015 }]);
  });

  // ─── 2. 문자열 토큰 ─────────────────────────────────────────
  it('2a. double-quoted string', () => {
    expect(tokenize('"hello"')).toEqual<Token[]>([{ kind: 'string', value: 'hello' }]);
  });

  it('2b. single-quoted string', () => {
    expect(tokenize("'world'")).toEqual<Token[]>([{ kind: 'string', value: 'world' }]);
  });

  it('2c. string with escape', () => {
    expect(tokenize('"a\\nb"')).toEqual<Token[]>([{ kind: 'string', value: 'a\nb' }]);
  });

  // ─── 3. 경로 토큰 ──────────────────────────────────────────
  it('3a. $nodes path', () => {
    expect(tokenize('$nodes.plan.data.confidence')).toEqual<Token[]>([
      { kind: 'path', value: '$nodes.plan.data.confidence' },
    ]);
  });

  it('3b. $loop.item path', () => {
    expect(tokenize('$loop.item')).toEqual<Token[]>([{ kind: 'path', value: '$loop.item' }]);
  });

  it('3c. $trigger.kind path', () => {
    expect(tokenize('$trigger.kind')).toEqual<Token[]>([{ kind: 'path', value: '$trigger.kind' }]);
  });

  // ─── 4. 연산자 토큰 ─────────────────────────────────────────
  it('4a. unary !', () => {
    expect(tokenize('!')).toEqual<Token[]>([{ kind: 'op', value: '!' }]);
  });

  it('4b. comparison >= <=', () => {
    expect(tokenize('>=')).toEqual<Token[]>([{ kind: 'op', value: '>=' }]);
    expect(tokenize('<=')).toEqual<Token[]>([{ kind: 'op', value: '<=' }]);
  });

  it('4c. equality ===', () => {
    expect(tokenize('===')).toEqual<Token[]>([{ kind: 'op', value: '===' }]);
  });

  it('4d. strict inequality !==', () => {
    expect(tokenize('!==')).toEqual<Token[]>([{ kind: 'op', value: '!==' }]);
  });

  it('4e. logical && ||', () => {
    const t = tokenize('&& ||');
    expect(t[0]).toEqual({ kind: 'op', value: '&&' });
    expect(t[1]).toEqual({ kind: 'op', value: '||' });
  });

  // ─── 5. bool · null 키워드 ─────────────────────────────────
  it('5a. true false null', () => {
    const t = tokenize('true false null');
    expect(t[0]).toEqual({ kind: 'bool', value: true });
    expect(t[1]).toEqual({ kind: 'bool', value: false });
    expect(t[2]).toEqual({ kind: 'null' });
  });

  // ─── 6. 괄호 ──────────────────────────────────────────────
  it('6. lparen rparen', () => {
    expect(tokenize('(')).toEqual<Token[]>([{ kind: 'lparen' }]);
    expect(tokenize(')')).toEqual<Token[]>([{ kind: 'rparen' }]);
  });

  // ─── 7. 공백 무시 ──────────────────────────────────────────
  it('7. whitespace is ignored', () => {
    const t = tokenize('  80  >=  0.8  ');
    expect(t).toEqual<Token[]>([
      { kind: 'number', value: 80 },
      { kind: 'op', value: '>=' },
      { kind: 'number', value: 0.8 },
    ]);
  });

  // ─── 8. 미지원 토큰 → EXPRESSION_UNSUPPORTED_TOKEN ─────────
  it('8a. arithmetic "+" → EXPRESSION_UNSUPPORTED_TOKEN', () => {
    expect(() => tokenize('1 + 2')).toThrow('EXPRESSION_UNSUPPORTED_TOKEN');
  });

  it('8b. arithmetic "*" → EXPRESSION_UNSUPPORTED_TOKEN', () => {
    expect(() => tokenize('1 * 2')).toThrow('EXPRESSION_UNSUPPORTED_TOKEN');
  });

  it('8c. ternary "?" → EXPRESSION_UNSUPPORTED_TOKEN', () => {
    expect(() => tokenize('$x ? 1 : 2')).toThrow('EXPRESSION_UNSUPPORTED_TOKEN');
  });

  it('8d. array index "[" → EXPRESSION_UNSUPPORTED_TOKEN', () => {
    expect(() => tokenize('$x[0]')).toThrow('EXPRESSION_UNSUPPORTED_TOKEN');
  });

  // ─── 9. $ 없는 식별자 → 에러 ─────────────────────────────
  it('9. bare identifier without $ → EXPRESSION_UNSUPPORTED_TOKEN', () => {
    expect(() => tokenize('foo.bar')).toThrow('EXPRESSION_UNSUPPORTED_TOKEN');
  });

  it('9b. bare identifier "status" → EXPRESSION_UNSUPPORTED_TOKEN', () => {
    expect(() => tokenize('status == "ok"')).toThrow('EXPRESSION_UNSUPPORTED_TOKEN');
  });

  // ─── 10. 닫히지 않은 문자열 → EXPRESSION_PARSE_ERROR ────────
  it('10. unclosed double-quote → EXPRESSION_PARSE_ERROR', () => {
    expect(() => tokenize('"hello')).toThrow('EXPRESSION_PARSE_ERROR');
  });

  it('10b. unclosed single-quote → EXPRESSION_PARSE_ERROR', () => {
    expect(() => tokenize("'world")).toThrow('EXPRESSION_PARSE_ERROR');
  });

  // ─── 11. 복합 표현식 ─────────────────────────────────────
  it('11. complex expression tokenizes all tokens', () => {
    const t = tokenize('$nodes.a.x >= 80 && $nodes.b.ok === true');
    expect(t.map((tok) => tok.kind)).toEqual([
      'path', 'op', 'number', 'op', 'path', 'op', 'bool',
    ]);
  });
});
