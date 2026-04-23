import type { TaskContext, ProjectContext, TriggerContext, NodeOutput } from '@/lib/adpl/types';
import type { ExecutionContext, FlowContext } from '../adapters/types';
import type { CompiledNode, ExecutionPlan } from '../compiler/types';
import type { PipelineRunState } from '../state/types';

export class ExecutionContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutionContextError';
  }
}

/**
 * Adapter 가 소비하는 Execution context 조립.
 *
 * v1 제약:
 * - $task / $project / $trigger: 런타임에 주입된 hint 없으면 빈 placeholder
 * - $loop / $flow: Stage 4 Flow Adapter 구현까지 null
 * - worktreeRoot: worktreeRootHint → task.config.projectDir → project.path 순 fallback; 없으면 throw
 */
export function buildExecutionContext(
  node: CompiledNode,
  plan: ExecutionPlan,
  state: PipelineRunState,
  env: Record<string, string> = {},
  worktreeRootHint?: string,
): ExecutionContext {
  const task = {} as unknown as TaskContext;
  const project = {} as unknown as ProjectContext;

  const worktreeRoot = worktreeRootHint ?? null;

  if (!worktreeRoot) {
    throw new ExecutionContextError(
      'Cannot determine worktreeRoot: task.config.projectDir and project.path both missing.',
    );
  }

  return {
    $task: task,
    $project: project,
    $trigger: {} as unknown as TriggerContext,
    $env: env,
    $now: new Date(),
    $self: node,
    $nodes: collectCompletedNodeOutputs(plan, state),
    $prev: findPrevNodeOutput(node, plan, state),
    $loop: null,
    $flow: buildFlowContext(node, plan, state),
    $variables: plan.context.variables,
    worktreeRoot,
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

/**
 * $flow: parallel flow node 컨텍스트 채우기 (parallel 전용, branch/loop 는 추후).
 *
 * - parallel 내 sub-node: { parentUserId, parentType: 'parallel' }
 * - parallel 완료 후 downstream 노드: { parentUserId, parentType: 'parallel', branches }
 */
function buildFlowContext(
  node: CompiledNode,
  plan: ExecutionPlan,
  state: PipelineRunState,
): FlowContext | null {
  // 이 노드가 parallel branch 내부인지 확인: pathId 패턴 *.branches.N.nodes...
  const inBranchMatch = node.pathId.match(/^(.+)\.branches\.\d+\.nodes/);
  if (inBranchMatch) {
    const parentPathId = inBranchMatch[1];
    const parentNode = plan.nodes.get(parentPathId);
    if (parentNode?.spec.type === 'parallel') {
      return { parentUserId: parentNode.userId, parentType: 'parallel' };
    }
  }

  // 직전 prerequisite 중 완료된 parallel 노드가 있으면 branches 결과 제공
  for (const prereqPathId of node.prerequisites) {
    const prereqNode = plan.nodes.get(prereqPathId);
    if (prereqNode?.spec.type !== 'parallel') continue;
    const prereqOutput = state.nodes.get(prereqPathId)?.output;
    if (!prereqOutput) continue;

    const rawBranches = (prereqOutput.data as Record<string, unknown> | null | undefined)?.branches;
    const branches: Record<string, { data: unknown }> = {};
    if (rawBranches && typeof rawBranches === 'object') {
      for (const [id, val] of Object.entries(rawBranches as Record<string, unknown>)) {
        branches[id] = { data: (val as Record<string, unknown> | null | undefined)?.data };
      }
    }
    return { parentUserId: prereqNode.userId, parentType: 'parallel', branches };
  }

  return null;
}
