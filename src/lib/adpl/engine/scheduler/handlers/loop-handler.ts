import type { LoopNodeSpec } from '@/lib/adpl/types/nodes/loop';
import type { NodeOutput } from '@/lib/adpl/types';
import type { FlowNodeHandler, FlowNodeOptions, RunSubNodeFn } from '../flow-handler';
import { evaluateCondition } from '../condition-evaluator';
import type { ExecutionContext, LoopContext } from '../../adapters/types';

type NodesMap = Record<string, NodeOutput>;
type SetLoopCtxFn = (loopNodePathId: string, ctx: LoopContext | null) => void;

function extractNodes(options: FlowNodeOptions): NodesMap {
  const nodes = (options as unknown as { $nodes?: NodesMap }).$nodes;
  return nodes ?? {};
}

function extractSetLoopCtx(options: FlowNodeOptions): SetLoopCtxFn | undefined {
  return (options as unknown as { setLoopCtx?: SetLoopCtxFn }).setLoopCtx;
}

const DEFAULT_MAX_ITERATIONS = 1000;

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

type LoopTerminated = 'complete' | 'max_iterations' | 'error' | 'break' | 'complete-with-errors';

interface IterationResult {
  index: number;
  item?: unknown;
  data: unknown;
  error?: string;
  failed?: boolean;
}

export const loopHandler: FlowNodeHandler<LoopNodeSpec> = {
  type: 'loop',

  async handle(spec, nodePathId, runSubNode, options): Promise<NodeOutput> {
    const { eventBus, token, runId } = options;
    const mode = spec.mode;
    const maxIterations = spec.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    eventBus.emit({
      type: 'flow.loop.start',
      timestamp: new Date(),
      runId,
      parentId: nodePathId,
      kind: mode === 'while' ? 'while' : 'forEach',
    });

    let terminated: LoopTerminated = 'complete';
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
          durationMs: 0,
        },
      };
    } finally {
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
): Promise<LoopTerminated> {
  const { eventBus, token, runId } = options;
  const $nodes = extractNodes(options);
  const setLoopCtxFn = extractSetLoopCtx(options);

  const overExpr = spec.over ?? '';
  const resolved = overExpr ? resolveOverExpression(overExpr, $nodes) : [];
  const items = Array.isArray(resolved) ? resolved : [];

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

    const loopCtx: LoopContext = {
      index,
      total,
      isFirst,
      isLast,
      item,
      ...(asKey ? { [asKey]: item } : {}),
    };

    setLoopCtxFn?.(nodePathId, loopCtx);

    eventBus.emit({
      type: 'flow.loop.iteration',
      timestamp: new Date(),
      runId,
      parentId: nodePathId,
      index,
    });

    let iterFailed = false;
    let iterError = '';
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
        iterFailed = true;
        iterError = output.error?.message ?? `Loop iteration ${index} sub-node failed`;
        break;
      }
      lastData = output.data;
    }

    if (iterFailed) {
      iterations.push({ index, item, data: undefined, error: iterError, failed: true });
      eventBus.emit({
        type: 'flow.loop.iteration.failed',
        timestamp: new Date(),
        runId,
        parentId: nodePathId,
        index,
        error: iterError,
      });
      continue;
    }

    iterations.push({ index, item, data: lastData });

    if (spec.breakCondition) {
      const breakCtx = makeCtxWithLoop(loopCtx);
      let shouldBreak: boolean;
      try {
        shouldBreak = evaluateCondition(spec.breakCondition, breakCtx);
      } catch (err) {
        throw new Error(
          `LOOP_BREAK_CONDITION_FAILED: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (shouldBreak) {
        eventBus.emit({
          type: 'flow.loop.break',
          timestamp: new Date(),
          runId,
          parentId: nodePathId,
          index,
        });
        return 'break';
      }
    }
  }

  const failureCount = iterations.filter((it) => it.failed).length;
  return failureCount > 0 ? 'complete-with-errors' : 'complete';
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
): Promise<LoopTerminated> {
  const { eventBus, token, runId } = options;
  const setLoopCtxFn = extractSetLoopCtx(options);
  const doNodes = spec.do ?? [];
  let index = 0;

  do {
    if (token.isCancelled) break;

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

    const loopCtx: LoopContext = {
      index,
      total: 0,
      isFirst: index === 0,
      isLast: false,
    };

    setLoopCtxFn?.(nodePathId, loopCtx);

    let iterFailed = false;
    let iterError = '';
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
        iterFailed = true;
        iterError = output.error?.message ?? `Loop iteration ${index} sub-node failed`;
        break;
      }
      lastData = output.data;
    }

    if (iterFailed) {
      iterations.push({ index, data: undefined, error: iterError, failed: true });
      eventBus.emit({
        type: 'flow.loop.iteration.failed',
        timestamp: new Date(),
        runId,
        parentId: nodePathId,
        index,
        error: iterError,
      });
    } else {
      iterations.push({ index, data: lastData });

      if (spec.breakCondition) {
        const breakCtx = makeCtxWithLoop(loopCtx);
        let shouldBreak: boolean;
        try {
          shouldBreak = evaluateCondition(spec.breakCondition, breakCtx);
        } catch (err) {
          throw new Error(
            `LOOP_BREAK_CONDITION_FAILED: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        if (shouldBreak) {
          eventBus.emit({
            type: 'flow.loop.break',
            timestamp: new Date(),
            runId,
            parentId: nodePathId,
            index,
          });
          return 'break';
        }
      }
    }

    index++;

    if (!spec.condition) break;

    const ctx = makeCtxWithLoop(loopCtx);
    const shouldContinue = evaluateCondition(spec.condition, ctx);
    if (!shouldContinue) break;
  } while (true);

  const failureCount = iterations.filter((it) => it.failed).length;
  return failureCount > 0 ? 'complete-with-errors' : 'complete';
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
): Promise<LoopTerminated> {
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

    let iterFailed = false;
    let iterError = '';
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
        iterFailed = true;
        iterError = output.error?.message ?? `Loop iteration ${index} sub-node failed`;
        break;
      }
      lastData = output.data;
    }

    if (iterFailed) {
      iterations.push({ index, data: undefined, error: iterError, failed: true });
      eventBus.emit({
        type: 'flow.loop.iteration.failed',
        timestamp: new Date(),
        runId,
        parentId: nodePathId,
        index,
        error: iterError,
      });
      continue;
    }

    iterations.push({ index, data: lastData });

    if (spec.breakCondition) {
      const breakCtx = makeCtxWithLoop(loopCtx);
      let shouldBreak: boolean;
      try {
        shouldBreak = evaluateCondition(spec.breakCondition, breakCtx);
      } catch (err) {
        throw new Error(
          `LOOP_BREAK_CONDITION_FAILED: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (shouldBreak) {
        eventBus.emit({
          type: 'flow.loop.break',
          timestamp: new Date(),
          runId,
          parentId: nodePathId,
          index,
        });
        return 'break';
      }
    }
  }

  const failureCount = iterations.filter((it) => it.failed).length;
  return failureCount > 0 ? 'complete-with-errors' : 'complete';
}
