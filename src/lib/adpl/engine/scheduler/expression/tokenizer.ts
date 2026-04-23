export type Token =
  | { kind: 'path'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'op'; value: '>' | '<' | '>=' | '<=' | '==' | '!=' | '===' | '!==' | '&&' | '||' | '!' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++;
      continue;
    }

    // 3-char operators first
    if (i + 2 < n) {
      const three = input.slice(i, i + 3);
      if (three === '===') { tokens.push({ kind: 'op', value: '===' }); i += 3; continue; }
      if (three === '!==') { tokens.push({ kind: 'op', value: '!==' }); i += 3; continue; }
    }

    // 2-char operators
    if (i + 1 < n) {
      const two = input.slice(i, i + 2);
      if (two === '==') { tokens.push({ kind: 'op', value: '==' }); i += 2; continue; }
      if (two === '!=') { tokens.push({ kind: 'op', value: '!=' }); i += 2; continue; }
      if (two === '>=') { tokens.push({ kind: 'op', value: '>=' }); i += 2; continue; }
      if (two === '<=') { tokens.push({ kind: 'op', value: '<=' }); i += 2; continue; }
      if (two === '&&') { tokens.push({ kind: 'op', value: '&&' }); i += 2; continue; }
      if (two === '||') { tokens.push({ kind: 'op', value: '||' }); i += 2; continue; }
    }

    // 1-char tokens
    if (ch === '>') { tokens.push({ kind: 'op', value: '>' }); i++; continue; }
    if (ch === '<') { tokens.push({ kind: 'op', value: '<' }); i++; continue; }
    if (ch === '!') { tokens.push({ kind: 'op', value: '!' }); i++; continue; }
    if (ch === '(') { tokens.push({ kind: 'lparen' }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen' }); i++; continue; }

    // Path: $identifier(.identifier)*
    if (ch === '$') {
      let j = i + 1;
      while (j < n && /[\w$.]/.test(input[j])) j++;
      const raw = input.slice(i, j);
      if (!/^\$[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*$/.test(raw)) {
        throw Object.assign(
          new Error(`EXPRESSION_UNSUPPORTED_TOKEN: invalid path expression "${raw}"`),
          { code: 'EXPRESSION_UNSUPPORTED_TOKEN' },
        );
      }
      tokens.push({ kind: 'path', value: raw });
      i = j;
      continue;
    }

    // Negative number literal: '-' followed by digit
    if (ch === '-') {
      const next = i + 1 < n ? input[i + 1] : '';
      if (/\d/.test(next)) {
        const m = /^-\d+(\.\d+)?([eE][+-]?\d+)?/.exec(input.slice(i));
        if (m) {
          tokens.push({ kind: 'number', value: Number(m[0]) });
          i += m[0].length;
          continue;
        }
      }
      throw Object.assign(
        new Error(`EXPRESSION_UNSUPPORTED_TOKEN: arithmetic operator "-" is not supported`),
        { code: 'EXPRESSION_UNSUPPORTED_TOKEN' },
      );
    }

    // Non-negative number
    if (/\d/.test(ch)) {
      const m = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(input.slice(i));
      if (m) {
        tokens.push({ kind: 'number', value: Number(m[0]) });
        i += m[0].length;
        continue;
      }
    }

    // String literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let str = '';
      while (j < n) {
        const c = input[j];
        if (c === '\\') {
          j++;
          if (j >= n) {
            throw Object.assign(
              new Error(`EXPRESSION_PARSE_ERROR: unterminated string literal`),
              { code: 'EXPRESSION_PARSE_ERROR' },
            );
          }
          switch (input[j]) {
            case 'n': str += '\n'; break;
            case 't': str += '\t'; break;
            case 'r': str += '\r'; break;
            default: str += input[j];
          }
          j++;
        } else if (c === quote) {
          break;
        } else {
          str += c;
          j++;
        }
      }
      if (j >= n) {
        throw Object.assign(
          new Error(`EXPRESSION_PARSE_ERROR: unterminated string literal`),
          { code: 'EXPRESSION_PARSE_ERROR' },
        );
      }
      tokens.push({ kind: 'string', value: str });
      i = j + 1;
      continue;
    }

    // Keywords and bare identifiers
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < n && /\w/.test(input[j])) j++;
      const word = input.slice(i, j);
      if (word === 'true') { tokens.push({ kind: 'bool', value: true }); i = j; continue; }
      if (word === 'false') { tokens.push({ kind: 'bool', value: false }); i = j; continue; }
      if (word === 'null') { tokens.push({ kind: 'null' }); i = j; continue; }
      throw Object.assign(
        new Error(`EXPRESSION_UNSUPPORTED_TOKEN: bare identifier "${word}" — prefix with $ (e.g. $variables.${word})`),
        { code: 'EXPRESSION_UNSUPPORTED_TOKEN' },
      );
    }

    // Unsupported characters
    const unsupported: Record<string, string> = {
      '+': 'arithmetic "+"', '*': 'arithmetic "*"', '/': 'arithmetic "/"',
      '%': 'arithmetic "%"', '?': 'ternary "?"', ':': 'ternary ":"',
      '[': 'index "["', ']': 'index "]"', '{': 'object "{"', '}': 'object "}"',
      ',': 'comma ","',
    };
    const desc = unsupported[ch] ?? `character "${ch}"`;
    throw Object.assign(
      new Error(`EXPRESSION_UNSUPPORTED_TOKEN: ${desc} is not supported`),
      { code: 'EXPRESSION_UNSUPPORTED_TOKEN' },
    );
  }

  return tokens;
}
