import type { LoopNodeSpec } from '@/lib/adpl/types/nodes/loop';
import type { NodeOutput } from '@/lib/adpl/types';
import type { FlowNodeHandler, FlowNodeOptions, RunSubNodeFn } from '../flow-handler';
import type { StructuredCondition } from '@/lib/adpl/types/expression';
import { evaluateCondition } from '../condition-evaluator';
import type { ExecutionContext, LoopContext } from '../../adapters/types';

type NodesMap = Record<string, NodeOutput>;
type SetLoopCtxFn = (loopNodePathId: string, ctx: LoopContext | null) => void;

/**
 * Scheduler 가 FlowNodeOptions 에 확장 필드로 주입하는 $nodes / setLoopCtx 를 추출.
 * FlowNodeOptions 타입 자체에는 이 필드가 없으므로 runtime 추출.
 */
function extractNodes(options: FlowNodeOptions): NodesMap {
  const nodes = (options as unknown as { $nodes?: NodesMap }).$nodes;
  return nodes ?? {};
}

function extractSetLoopCtx(options: FlowNodeOptions): SetLoopCtxFn | undefined {
  return (options as unknown as { setLoopCtx?: SetLoopCtxFn }).setLoopCtx;
}

const DEFAULT_MAX_ITERATIONS = 1000;

/**
 * $loop 컨텍스트를 포함한 최소 ExecutionContext stub.
 * while 조건 평가에 사용.
 */
function makeCtxWithLoop(loopCtx: LoopContext | null): ExecutionContext {
  return {
    $task: {} as ExecutionContext['$task'],
    $project: {} as ExecutionContext['$project'],
    $trigger: {} as ExecutionContext['$trigger'],
    $env: {},
    $now: new Date(),
    $self: {} as ExecutionContext['$self'],
    $nodes: {} as ExecutionContext['$nodes'],
    $prev: null,
    $loop: loopCtx,
    $flow: null,
    $variables: {},
    worktreeRoot: '/',
  };
}

/**
 * forEach 의 over 필드를 resolve.
 * '$nodes.X.Y.Z' 형태의 dot-access 지원 (간이 파서).
 * 리터럴 값은 JSON.parse 시도 (Stage 5 이전 Jexl 미지원).
 *
 * - `$nodes.foo.bar.baz` → nodes.foo.bar.baz 경로 탐색
 * - `$task.*`, `$loop.*` 등 기타 `$` prefix → undefined (아직 미지원)
 * - `$` 미시작: JSON.parse → 실패 시 원본 문자열 그대로 반환
 */
function resolveOverExpression(over: string, $nodes: NodesMap): unknown {
  if (!over.startsWith('$')) {
    try {
      return JSON.parse(over);
    } catch {
      return over;
    }
  }
  if (!over.startsWith('$nodes.')) {
    return undefined;
  }
  const segments = over.slice('$nodes.'.length).split('.');
  let current: unknown = $nodes;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

interface IterationResult {
  index: number;
  item?: unknown;
  data: unknown;
}

export const loopHandler: FlowNodeHandler<LoopNodeSpec> = {
  type: 'loop',

  async handle(spec, nodePathId, runSubNode, options): Promise<NodeOutput> {
    const { eventBus, token, runId } = options;
    const mode = spec.mode;
    const maxIterations = spec.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    // flow.loop.start 이벤트
    eventBus.emit({
      type: 'flow.loop.start',
      timestamp: new Date(),
      runId,
      parentId: nodePathId,
      kind: mode === 'while' ? 'while' : 'forEach',
    });

    let terminated: 'complete' | 'max_iterations' | 'error' = 'complete';
    const iterations: IterationResult[] = [];
    const setLoopCtxFn = extractSetLoopCtx(options);

    try {
      try {
        if (mode === 'forEach') {
          terminated = await runForEach(
            spec, nodePathId, runSubNode, options, maxIterations, iterations,
          );
        } else if (mode === 'while') {
          terminated = await runWhile(
            spec, nodePathId, runSubNode, options, maxIterations, iterations,
          );
        } else if (mode === 'times') {
          terminated = await runTimes(
            spec, nodePathId, runSubNode, options, maxIterations, iterations,
          );
        } else {
          throw new Error(`[LoopHandler] Unknown loop mode: ${String(mode)}`);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isMaxIter = errMsg.startsWith('LOOP_MAX_ITERATIONS_EXCEEDED');

        eventBus.emit({
          type: 'flow.loop.complete',
          timestamp: new Date(),
          runId,
          parentId: nodePathId,
          iterationCount: iterations.length,
          terminated: isMaxIter ? 'max_iterations' : 'error',
        });

        // LOOP_MAX_ITERATIONS_EXCEEDED → 상위로 전파 (throw)
        if (isMaxIter) {
          throw err;
        }

        return {
          status: 'failure',
          data: {
            iterations,
            iterationCount: iterations.length,
            terminated: 'error',
          },
          error: {
            code: 'loop_iteration_failure',
            message: errMsg,
            category: 'persistent',
          },
        };
      }

      // flow.loop.complete 이벤트
      eventBus.emit({
        type: 'flow.loop.complete',
        timestamp: new Date(),
        runId,
        parentId: nodePathId,
        iterationCount: iterations.length,
        terminated,
      });

      return {
        status: 'success',
        data: {
          iterations,
          iterationCount: iterations.length,
          terminated,
        },
        metrics: {
          durationMs: 0, // Scheduler 레이어에서 덮어씀
        },
      };
    } finally {
      // 모든 iteration 종료 후 loopCtx 정리 (성공/실패/throw 무관)
      setLoopCtxFn?.(nodePathId, null);
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// forEach 실행
// ──────────────────────────────────────────────────────────────────────────────
async function runForEach(
  spec: LoopNodeSpec,
  nodePathId: string,
  runSubNode: RunSubNodeFn,
  options: FlowNodeOptions,
  maxIterations: number,
  iterations: IterationResult[],
): Promise<'complete' | 'max_iterations' | 'error'> {
  const { eventBus, token, runId } = options;
  const $nodes = extractNodes(options);
  const setLoopCtxFn = extractSetLoopCtx(options);

  // over 필드에서 items 배열 resolve ($nodes.X.Y 경로 탐색 지원)
  const overExpr = spec.over ?? '';
  const resolved = overExpr ? resolveOverExpression(overExpr, $nodes) : [];
  const items = Array.isArray(resolved) ? resolved : [];

  // items.length > maxIterations → throw before running
  if (items.length > maxIterations) {
    throw new Error(
      `LOOP_MAX_ITERATIONS_EXCEEDED: forEach items length (${items.length}) exceeds maxIterations (${maxIterations})`,
    );
  }

  const asKey = spec.as;
  const total = items.length;
  const doNodes = spec.do ?? [];

  for (let index = 0; index < total; index++) {
    if (token.isCancelled) break;

    const item = items[index];
    const isFirst = index === 0;
    const isLast = index === total - 1;

    // $loop 컨텍스트 구성 — LoopContext 타입 만족
    const loopCtx: LoopContext = {
      index,
      total,
      isFirst,
      isLast,
      item,
      ...(asKey ? { [asKey]: item } : {}),
    };

    // 현재 iteration 의 loopCtx 를 FlowRunState 에 주입 — sub-node 의 ExecutionContext.$loop 로 전달됨
    setLoopCtxFn?.(nodePathId, loopCtx);

    eventBus.emit({
      type: 'flow.loop.iteration',
      timestamp: new Date(),
      runId,
      parentId: nodePathId,
      index,
    });

    // doNodes 순차 실행
    let lastData: unknown = null;
    for (let nodeIdx = 0; nodeIdx < doNodes.length; nodeIdx++) {
      const subPathId = `${nodePathId}.do.${index}.${nodeIdx}`;
      const output = await runSubNode(subPathId);
      if (output.status !== 'success') {
        // continueOnIterFailure 미설정 → 기본 false → 에러 전파
        if (!spec.continueOnIterFailure) {
          throw new Error(
            output.error?.message ?? `Loop iteration ${index} sub-node failed`,
          );
        }
        lastData = null;
        break;
      }
      lastData = output.data;
    }

    iterations.push({ index, item, data: lastData });
  }

  return 'complete';
}

// ──────────────────────────────────────────────────────────────────────────────
// while (post-test / do-while) 실행
// ──────────────────────────────────────────────────────────────────────────────
async function runWhile(
  spec: LoopNodeSpec,
  nodePathId: string,
  runSubNode: RunSubNodeFn,
  options: FlowNodeOptions,
  maxIterations: number,
  iterations: IterationResult[],
): Promise<'complete' | 'max_iterations' | 'error'> {
  const { eventBus, token, runId } = options;
  const setLoopCtxFn = extractSetLoopCtx(options);
  const doNodes = spec.do ?? [];
  let index = 0;

  // post-test (do-while): 최소 1회 실행 후 조건 평가
  do {
    if (token.isCancelled) break;

    // maxIterations 초과 확인 (index >= maxIterations → throw)
    if (index >= maxIterations) {
      throw new Error(
        `LOOP_MAX_ITERATIONS_EXCEEDED: while loop reached maxIterations (${maxIterations})`,
      );
    }

    eventBus.emit({
      type: 'flow.loop.iteration',
      timestamp: new Date(),
      runId,
      parentId: nodePathId,
      index,
    });

    // LoopContext: total 은 while 에서 알 수 없으므로 0 사용 (isLast 미지원)
    const loopCtx: LoopContext = {
      index,
      total: 0,
      isFirst: index === 0,
      isLast: false, // while 은 마지막 여부 미리 알 수 없음
    };

    // 현재 iteration 의 loopCtx 주입
    setLoopCtxFn?.(nodePathId, loopCtx);

    // doNodes 순차 실행
    let lastData: unknown = null;
    for (let nodeIdx = 0; nodeIdx < doNodes.length; nodeIdx++) {
      const subPathId = `${nodePathId}.do.${index}.${nodeIdx}`;
      const output = await runSubNode(subPathId);
      if (output.status !== 'success') {
        if (!spec.continueOnIterFailure) {
          throw new Error(
            output.error?.message ?? `Loop iteration ${index} sub-node failed`,
          );
        }
        lastData = null;
        break;
      }
      lastData = output.data;
    }

    iterations.push({ index, data: lastData });

    index++;

    // 조건 평가 — 없으면 1회 실행 후 종료
    if (!spec.condition) break;

    if (typeof spec.condition === 'string') {
      throw new Error(
        `[LoopHandler] string condition is not supported until Stage 5. Use StructuredCondition instead.`,
      );
    }

    const ctx = makeCtxWithLoop(loopCtx);
    const shouldContinue = evaluateCondition(spec.condition as StructuredCondition, ctx);
    if (!shouldContinue) break;
  } while (true);

  return 'complete';
}

// ──────────────────────────────────────────────────────────────────────────────
// times 실행
// ──────────────────────────────────────────────────────────────────────────────
async function runTimes(
  spec: LoopNodeSpec,
  nodePathId: string,
  runSubNode: RunSubNodeFn,
  options: FlowNodeOptions,
  maxIterations: number,
  iterations: IterationResult[],
): Promise<'complete' | 'max_iterations' | 'error'> {
  const { eventBus, token, runId } = options;
  const setLoopCtxFn = extractSetLoopCtx(options);
  const count = spec.count ?? 0;
  const doNodes = spec.do ?? [];

  if (count > maxIterations) {
    throw new Error(
      `LOOP_MAX_ITERATIONS_EXCEEDED: times count (${count}) exceeds maxIterations (${maxIterations})`,
    );
  }

  for (let index = 0; index < count; index++) {
    if (token.isCancelled) break;

    const loopCtx: LoopContext = {
      index,
      total: count,
      isFirst: index === 0,
      isLast: index === count - 1,
    };
    setLoopCtxFn?.(nodePathId, loopCtx);

    eventBus.emit({
      type: 'flow.loop.iteration',
      timestamp: new Date(),
      runId,
      parentId: nodePathId,
      index,
    });

    let lastData: unknown = null;
    for (let nodeIdx = 0; nodeIdx < doNodes.length; nodeIdx++) {
      const subPathId = `${nodePathId}.do.${index}.${nodeIdx}`;
      const output = await runSubNode(subPathId);
      if (output.status !== 'success') {
        if (!spec.continueOnIterFailure) {
          throw new Error(
            output.error?.message ?? `Loop iteration ${index} sub-node failed`,
          );
        }
        lastData = null;
        break;
      }
      lastData = output.data;
    }

    iterations.push({ index, data: lastData });
  }

  return 'complete';
}
