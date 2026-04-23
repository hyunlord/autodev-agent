import type { GateNodeSpec } from '@/lib/adpl/types/nodes/gate';
import type { NodeOutput } from '@/lib/adpl/types';
import type { FlowNodeHandler, FlowNodeOptions, RunSubNodeFn } from '../flow-handler';
import type { StructuredCondition } from '@/lib/adpl/types/expression';
import { evaluateCondition } from '../condition-evaluator';
import type { ExecutionContext } from '../../adapters/types';

/**
 * gate handler 용 최소 ExecutionContext stub.
 * branch-handler 와 동일한 패턴 — $nodes 는 빈 객체.
 * Stage 5 에서 실제 $nodes 주입 예정.
 */
function makeMinimalCtx(): ExecutionContext {
  return {
    $task: {} as ExecutionContext['$task'],
    $project: {} as ExecutionContext['$project'],
    $trigger: {} as ExecutionContext['$trigger'],
    $env: {},
    $now: new Date(),
    $self: {} as ExecutionContext['$self'],
    $nodes: {} as ExecutionContext['$nodes'],
    $prev: null,
    $loop: null,
    $flow: null,
    $variables: {},
    worktreeRoot: '/',
  };
}

export const gateHandler: FlowNodeHandler<GateNodeSpec> = {
  type: 'gate',

  async handle(spec, nodePathId, _runSubNode: RunSubNodeFn, options): Promise<NodeOutput> {
    const { eventBus, token, runId } = options;

    // 취소 체크 — 즉시 반환
    if (token.isCancelled) {
      return { status: 'cancelled' };
    }

    // flow.gate.opened 이벤트
    eventBus.emit({
      type: 'flow.gate.opened',
      timestamp: new Date(),
      runId,
      gateId: nodePathId,
      waitId: spec.id,
    });

    // 조건 평가
    const ctx = makeMinimalCtx();
    let passed: boolean;

    try {
      passed = evaluateCondition(spec.condition as StructuredCondition, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // flow.gate.decided — error
      eventBus.emit({
        type: 'flow.gate.decided',
        timestamp: new Date(),
        runId,
        gateId: nodePathId,
        decision: 'error',
        decidedBy: 'condition',
      });
      return {
        status: 'failure',
        error: {
          code: 'GATE_CONDITION_EVAL_FAILED',
          message: `GATE_CONDITION_EVAL_FAILED: ${msg}`,
          category: 'persistent',
        },
      };
    }

    const decision = passed ? 'pass' : 'fail';

    // flow.gate.decided 이벤트
    eventBus.emit({
      type: 'flow.gate.decided',
      timestamp: new Date(),
      runId,
      gateId: nodePathId,
      decision,
      decidedBy: 'condition',
    });

    if (passed) {
      return {
        status: 'success',
        data: { passed: true, gateId: spec.id },
      };
    }

    // 조건 false — onFail 정책 적용
    const failMessage = spec.message ?? `Gate condition failed for gate "${spec.id}"`;
    const onFail = spec.onFail ?? 'throw';

    if (onFail === 'fail_node') {
      return {
        status: 'failure',
        error: {
          code: 'GATE_CONDITION_FAILED',
          message: failMessage,
          category: 'persistent',
        },
      };
    }

    // onFail === 'throw' (기본값)
    throw Object.assign(new Error(failMessage), { code: 'GATE_CONDITION_FAILED' });
  },
};
