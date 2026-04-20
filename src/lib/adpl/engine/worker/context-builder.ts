import type { TaskContext, ProjectContext, TriggerContext, NodeOutput } from '@/lib/adpl/types';
import type { ExecutionContext } from '../adapters/types';
import type { CompiledNode, ExecutionPlan } from '../compiler/types';
import type { PipelineRunState } from '../state/types';

/**
 * Adapter 가 소비하는 Execution context 조립.
 *
 * v1 제약:
 * - $task / $project / $trigger: 런타임에 주입된 hint 없으면 빈 placeholder
 * - $loop / $flow: Stage 4 Flow Adapter 구현까지 null
 */
export function buildExecutionContext(
  node: CompiledNode,
  plan: ExecutionPlan,
  state: PipelineRunState,
  env: Record<string, string> = {},
): ExecutionContext {
  return {
    $task: {} as unknown as TaskContext,
    $project: {} as unknown as ProjectContext,
    $trigger: {} as unknown as TriggerContext,
    $env: env,
    $now: new Date(),
    $self: node,
    $nodes: collectCompletedNodeOutputs(plan, state),
    $prev: findPrevNodeOutput(node, plan, state),
    $loop: null,
    $flow: null,
    $variables: plan.context.variables,
  };
}

/**
 * $nodes: userId 기준, 완료(success/failure) 노드만 포함.
 * 표현식 파서(Stage 5)가 $nodes.<userId> 로 참조.
 */
function collectCompletedNodeOutputs(
  plan: ExecutionPlan,
  state: PipelineRunState,
): Record<string, NodeOutput> {
  const out: Record<string, NodeOutput> = {};
  for (const node of plan.nodes.values()) {
    const s = state.nodes.get(node.pathId);
    if (s?.output && (s.status === 'success' || s.status === 'failure')) {
      out[node.userId] = s.output;
    }
  }
  return out;
}

/**
 * $prev: topologicalOrder 에서 이 노드 바로 앞에 있는 직전 prereq 의 output.
 * prerequisites 중 topologicalOrder 인덱스가 가장 큰 것 = 직전 노드.
 * 없으면 null.
 */
function findPrevNodeOutput(
  node: CompiledNode,
  plan: ExecutionPlan,
  state: PipelineRunState,
): NodeOutput | null {
  if (node.prerequisites.length === 0) return null;

  let prevPathId: string | null = null;
  let maxIdx = -1;

  for (const prereqId of node.prerequisites) {
    const idx = plan.topologicalOrder.indexOf(prereqId);
    if (idx > maxIdx) {
      maxIdx = idx;
      prevPathId = prereqId;
    }
  }

  if (!prevPathId) return null;
  return state.nodes.get(prevPathId)?.output ?? null;
}
