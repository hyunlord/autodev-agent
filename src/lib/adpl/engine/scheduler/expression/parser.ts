import type { Token } from './tokenizer';

export type Ast =
  | { kind: 'path'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'binary'; op: string; left: Ast; right: Ast }
  | { kind: 'unary'; op: '!'; operand: Ast };

/**
 * 재귀 하향 파서 (recursive descent).
 * 우선순위 (높음→낮음): ! > >= <= > < > == != === !== > && > ||
 */
export function parse(tokens: Token[]): Ast {
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function consume(): Token {
    return tokens[pos++];
  }

  function parseExpr(): Ast {
    return parseOr();
  }

  // ||
  function parseOr(): Ast {
    let left = parseAnd();
    while (peek()?.kind === 'op' && (peek() as { value: string }).value === '||') {
      consume();
      const right = parseAnd();
      left = { kind: 'binary', op: '||', left, right };
    }
    return left;
  }

  // &&
  function parseAnd(): Ast {
    let left = parseEquality();
    while (peek()?.kind === 'op' && (peek() as { value: string }).value === '&&') {
      consume();
      const right = parseEquality();
      left = { kind: 'binary', op: '&&', left, right };
    }
    return left;
  }

  // == != === !==
  function parseEquality(): Ast {
    let left = parseComparison();
    while (true) {
      const t = peek();
      if (t?.kind === 'op' && ['==', '!=', '===', '!=='].includes((t as { value: string }).value)) {
        consume();
        const right = parseComparison();
        left = { kind: 'binary', op: (t as { value: string }).value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  // > < >= <=
  function parseComparison(): Ast {
    let left = parseUnary();
    while (true) {
      const t = peek();
      if (t?.kind === 'op' && ['>', '<', '>=', '<='].includes((t as { value: string }).value)) {
        consume();
        const right = parseUnary();
        left = { kind: 'binary', op: (t as { value: string }).value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  // unary !
  function parseUnary(): Ast {
    const t = peek();
    if (t?.kind === 'op' && (t as { value: string }).value === '!') {
      consume();
      const operand = parseUnary();
      return { kind: 'unary', op: '!', operand };
    }
    return parsePrimary();
  }

  function parsePrimary(): Ast {
    const t = peek();
    if (!t) {
      throw Object.assign(
        new Error(`EXPRESSION_PARSE_ERROR: unexpected end of input`),
        { code: 'EXPRESSION_PARSE_ERROR' },
      );
    }

    if (t.kind === 'lparen') {
      consume();
      const inner = parseExpr();
      const close = peek();
      if (!close || close.kind !== 'rparen') {
        throw Object.assign(
          new Error(`EXPRESSION_PARSE_ERROR: expected closing ')' but got ${close ? JSON.stringify(close) : 'end of input'}`),
          { code: 'EXPRESSION_PARSE_ERROR' },
        );
      }
      consume();
      return inner;
    }

    if (t.kind === 'path') { consume(); return { kind: 'path', value: t.value }; }
    if (t.kind === 'number') { consume(); return { kind: 'number', value: t.value }; }
    if (t.kind === 'string') { consume(); return { kind: 'string', value: t.value }; }
    if (t.kind === 'bool') { consume(); return { kind: 'bool', value: t.value }; }
    if (t.kind === 'null') { consume(); return { kind: 'null' }; }

    throw Object.assign(
      new Error(`EXPRESSION_PARSE_ERROR: unexpected token ${JSON.stringify(t)}`),
      { code: 'EXPRESSION_PARSE_ERROR' },
    );
  }

  const ast = parseExpr();

  if (pos < tokens.length) {
    throw Object.assign(
      new Error(`EXPRESSION_PARSE_ERROR: unexpected token at position ${pos}: ${JSON.stringify(tokens[pos])}`),
      { code: 'EXPRESSION_PARSE_ERROR' },
    );
  }

  return ast;
}
