import type { BranchNodeSpec } from '@/lib/adpl/types/nodes/branch';
import type { NodeOutput } from '@/lib/adpl/types';
import type { FlowNodeHandler, FlowNodeOptions, RunSubNodeFn } from '../flow-handler';
import { evaluateCondition } from '../condition-evaluator';
import type { ExecutionContext } from '../../adapters/types';

function makeMinimalCtx(nodeOutputs: Record<string, unknown>): ExecutionContext {
  return {
    $task: {} as ExecutionContext['$task'],
    $project: {} as ExecutionContext['$project'],
    $trigger: {} as ExecutionContext['$trigger'],
    $env: {},
    $now: new Date(),
    $self: {} as ExecutionContext['$self'],
    $nodes: nodeOutputs as ExecutionContext['$nodes'],
    $prev: null,
    $loop: null,
    $flow: null,
    $variables: {},
    worktreeRoot: '/',
  };
}

export const branchHandler: FlowNodeHandler<BranchNodeSpec> = {
  type: 'branch',

  async handle(spec, nodePathId, runSubNode, options): Promise<NodeOutput> {
    const { eventBus, token, runId } = options;
    const cases = spec.cases ?? [];
    const evaluationMode = spec.evaluationMode ?? 'first_match';
    const onMissingMatch = spec.onMissingMatch ?? 'skip';

    // Scheduler 가 buildFlowHandlerOptions() 로 주입한 $nodes 를 추출.
    const $nodes = (options as unknown as { $nodes?: Record<string, unknown> }).$nodes ?? {};
    const ctx = makeMinimalCtx($nodes);

    // 조건 평가 — string condition 은 Stage 5 이전 미지원
    let selectedCaseIdx = -1;

    try {
      if (evaluationMode === 'first_match') {
        for (let i = 0; i < cases.length; i++) {
          const c = cases[i];
          if (c.default) {
            // default case 는 마지막 fallback — 다른 매칭이 없으면 선택
            // first_match 에서 default 는 우선순위가 낮으므로 아직 기록만
            if (selectedCaseIdx === -1) {
              // default 를 임시 후보로 등록하되 non-default 에게 양보
              // → 루프 끝까지 가서 non-default 가 없으면 사용
            }
            continue;
          }
          if (!c.when) continue;

          let matched: boolean;
          try {
            matched = evaluateCondition(c.when, ctx);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw Object.assign(
              new Error(`BRANCH_CONDITION_EVAL_FAILED: ${msg}`),
              { code: 'BRANCH_CONDITION_EVAL_FAILED' },
            );
          }

          if (matched) {
            selectedCaseIdx = i;
            break;
          }
        }

        // default fallback
        if (selectedCaseIdx === -1) {
          const defaultIdx = cases.findIndex((c) => c.default === true);
          if (defaultIdx !== -1) {
            selectedCaseIdx = defaultIdx;
          }
        }
      } else {
        // all_match: 매칭되는 모든 case 실행 (순서대로)
        // 여기서는 first_match 처럼 동작하되 break 없이 모든 case 실행
        // D2 scope: first_match 가 주 경로, all_match 는 기본 구현
        for (let i = 0; i < cases.length; i++) {
          const c = cases[i];
          if (c.default) {
            if (selectedCaseIdx === -1) selectedCaseIdx = i;
            continue;
          }
          if (!c.when) continue;

          let matched: boolean;
          try {
            matched = evaluateCondition(c.when, ctx);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw Object.assign(
              new Error(`BRANCH_CONDITION_EVAL_FAILED: ${msg}`),
              { code: 'BRANCH_CONDITION_EVAL_FAILED' },
            );
          }

          if (matched && selectedCaseIdx === -1) {
            selectedCaseIdx = i;
            // all_match 에서는 첫 번째 매칭된 case 만 실행 (D2 scope)
            break;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'failure',
        error: {
          code: 'BRANCH_CONDITION_EVAL_FAILED',
          message: msg,
          category: 'persistent',
        },
      };
    }

    // 매칭 없음 처리
    if (selectedCaseIdx === -1) {
      if (onMissingMatch === 'error') {
        return {
          status: 'failure',
          error: {
            code: 'BRANCH_NO_MATCH',
            message: `No matching case found in branch node "${nodePathId}"`,
            category: 'persistent',
          },
        };
      }
      // skip: 빈 성공 반환
      eventBus.emit({
        type: 'flow.branch.select',
        timestamp: new Date(),
        runId,
        branchNodeId: nodePathId,
        selectedCase: null,
      });
      return { status: 'success', data: { selectedCase: null, result: undefined } };
    }

    const selectedCase = cases[selectedCaseIdx];
    const caseLabel = selectedCase.default ? 'default' : `case[${selectedCaseIdx}]`;

    // 선택된 case emit
    eventBus.emit({
      type: 'flow.branch.select',
      timestamp: new Date(),
      runId,
      branchNodeId: nodePathId,
      selectedCase: caseLabel,
    });

    // then 노드 순차 실행
    const thenNodes = selectedCase.then ?? [];
    if (thenNodes.length === 0) {
      return { status: 'success', data: { selectedCase: caseLabel, result: undefined } };
    }

    // pathId 규칙: {branchNodePathId}.cases.{caseIdx}.then.{nodeIdx}
    const subPathIds = thenNodes.map(
      (_, nodeIdx) => `${nodePathId}.cases.${selectedCaseIdx}.then.${nodeIdx}`,
    );

    let lastOutput: NodeOutput | undefined;
    for (const subPathId of subPathIds) {
      if (token.isCancelled) {
        return {
          status: 'cancelled',
          data: { selectedCase: caseLabel, result: lastOutput?.data },
        };
      }

      const output = await runSubNode(subPathId);
      if (output.status !== 'success') {
        // then 내부 노드 실패 → 전파
        return output;
      }
      lastOutput = output;
    }

    return {
      status: 'success',
      data: { selectedCase: caseLabel, result: lastOutput?.data },
    };
  },
};
