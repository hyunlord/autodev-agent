import type { ExecutionContext } from '../../adapters/types';
import type { Ast } from './parser';

export function isTruthy(v: unknown): boolean {
  return Boolean(v);
}

/**
 * $ 접두사 경로를 ExecutionContext 에서 resolve.
 * condition-evaluator 의 resolveField 와 동일 로직 (순환 의존 방지를 위해 인라인).
 */
function resolvePath(path: string, ctx: ExecutionContext): unknown {
  const parts = path.split('.');
  const root = parts[0];

  let current: unknown;
  switch (root) {
    case '$nodes':     current = ctx.$nodes; break;
    case '$prev':      current = ctx.$prev; break;
    case '$loop':      current = ctx.$loop; break;
    case '$flow':      current = ctx.$flow; break;
    case '$env':       current = ctx.$env; break;
    case '$variables': current = ctx.$variables; break;
    case '$task':      current = ctx.$task; break;
    case '$project':   current = ctx.$project; break;
    case '$trigger':   current = ctx.$trigger; break;
    default:           return undefined;
  }

  for (let i = 1; i < parts.length; i++) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[parts[i]];
  }

  return current;
}

// NaN-safe: comparisons with NaN return false (desired behavior for missing paths)
function toNum(v: unknown): number {
  return Number(v);
}

export function evaluate(ast: Ast, ctx: ExecutionContext): unknown {
  switch (ast.kind) {
    case 'number': return ast.value;
    case 'string': return ast.value;
    case 'bool':   return ast.value;
    case 'null':   return null;
    case 'path':   return resolvePath(ast.value, ctx);

    case 'unary':
      return !isTruthy(evaluate(ast.operand, ctx));

    case 'binary': {
      // short-circuit logical operators
      if (ast.op === '&&') {
        const l = evaluate(ast.left, ctx);
        if (!isTruthy(l)) return false;
        return isTruthy(evaluate(ast.right, ctx));
      }
      if (ast.op === '||') {
        const l = evaluate(ast.left, ctx);
        if (isTruthy(l)) return true;
        return isTruthy(evaluate(ast.right, ctx));
      }

      const l = evaluate(ast.left, ctx);
      const r = evaluate(ast.right, ctx);

      switch (ast.op) {
        case '==':  return l == r;   // eslint-disable-line eqeqeq
        case '===': return l === r;
        case '!=':  return l != r;   // eslint-disable-line eqeqeq
        case '!==': return l !== r;
        case '>':   return toNum(l) >  toNum(r);
        case '<':   return toNum(l) <  toNum(r);
        case '>=':  return toNum(l) >= toNum(r);
        case '<=':  return toNum(l) <= toNum(r);
        default:
          throw Object.assign(
            new Error(`[Evaluator] unknown operator "${ast.op}"`),
            { code: 'EXPRESSION_RUNTIME_ERROR' },
          );
      }
    }
  }
}
