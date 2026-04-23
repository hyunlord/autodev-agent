import type { ExecutionContext } from '../../adapters/types';
import { tokenize } from './tokenizer';
import { parse } from './parser';
import { evaluate, isTruthy } from './evaluator';

export { isTruthy };

/**
 * ADPL string expression 을 평가하여 boolean 반환.
 * 에러 코드:
 *   EXPRESSION_PARSE_ERROR        — tokenize/parse 실패
 *   EXPRESSION_UNSUPPORTED_TOKEN  — 지원 범위 외 구문 (산술, 삼항, 함수 호출 등)
 *   EXPRESSION_RUNTIME_ERROR      — 실행 중 resolve/evaluate 실패
 */
export function evaluateStringCondition(expr: string, ctx: ExecutionContext): boolean {
  let tokens;
  try {
    tokens = tokenize(expr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw Object.assign(new Error(msg), { code: 'EXPRESSION_PARSE_ERROR' });
  }

  let ast;
  try {
    ast = parse(tokens);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw Object.assign(new Error(msg), { code: 'EXPRESSION_PARSE_ERROR' });
  }

  try {
    const result = evaluate(ast, ctx);
    return isTruthy(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw Object.assign(new Error(`EXPRESSION_RUNTIME_ERROR: ${msg}`), { code: 'EXPRESSION_RUNTIME_ERROR' });
  }
}
