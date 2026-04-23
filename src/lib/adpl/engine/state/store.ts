import { nanoid } from 'nanoid';
import type { ExecutionPlan, CompiledNode } from '../compiler/types';
import type { ParallelNodeSpec } from '@/lib/adpl/types/nodes/parallel';
import type {
  PipelineRunState,
  NodeRunState,
  FlowRunState,
  NodeStatus,
  PipelineStatus,
} from './types';
import { validateTransition, isTerminal } from './state-machine';

export class StateStore {
  private runs = new Map<string, PipelineRunState>();

  create(plan: ExecutionPlan): PipelineRunState {
    const runId = nanoid();
    const nodes = new Map<string, NodeRunState>();
    const flowStates = new Map<string, FlowRunState>();

    for (const node of plan.nodes.values()) {
      nodes.set(node.pathId, {
        nodeId: node.pathId,
        status: 'pending',
        attemptNumber: 0,
      });

      if (isFlowType(node.spec.type)) {
        flowStates.set(node.pathId, createFlowState(node));
      }
    }

    const state: PipelineRunState = {
      id: runId,
      executionPlanId: plan.id,
      status: 'initializing',
      nodes,
      flowStates,
      startedAt: new Date(),
      totalCostUsd: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
    };

    this.runs.set(runId, state);
    return state;
  }

  get(runId: string): PipelineRunState | null {
    return this.runs.get(runId) ?? null;
  }

  getNode(runId: string, nodeId: string): NodeRunState | null {
    return this.runs.get(runId)?.nodes.get(nodeId) ?? null;
  }

  getFlow(runId: string, flowNodeId: string): FlowRunState | null {
    return this.runs.get(runId)?.flowStates.get(flowNodeId) ?? null;
  }

  /**
   * 동적 서브노드 등록 — loop 반복 실행 시 컴파일 타임에 없는 pathId 를 런타임에 추가.
   * 이미 존재하는 경우 무시 (idempotent).
   */
  registerDynamicNode(runId: string, nodeId: string): void {
    const state = this.runs.get(runId);
    if (!state) throw new Error(`PipelineRun "${runId}" 가 존재하지 않습니다`);
    if (!state.nodes.has(nodeId)) {
      state.nodes.set(nodeId, { nodeId, status: 'pending', attemptNumber: 0 });
    }
  }

  updateNode(
    runId: string,
    nodeId: string,
    updater: (current: NodeRunState) => Partial<NodeRunState>,
  ): NodeRunState {
    const state = this.runs.get(runId);
    if (!state) throw new Error(`PipelineRun "${runId}" 가 존재하지 않습니다`);
    const current = state.nodes.get(nodeId);
    if (!current) throw new Error(`노드 "${nodeId}" 가 존재하지 않습니다`);

    const updates = updater(current);

    if (updates.status && updates.status !== current.status) {
      validateTransition(nodeId, current.status, updates.status);
    }

    const next: NodeRunState = { ...current, ...updates };
    state.nodes.set(nodeId, next);
    return next;
  }

  updateFlow(
    runId: string,
    flowNodeId: string,
    updater: (current: FlowRunState) => Partial<FlowRunState>,
  ): FlowRunState {
    const state = this.runs.get(runId);
    if (!state) throw new Error(`PipelineRun "${runId}" 가 존재하지 않습니다`);
    const current = state.flowStates.get(flowNodeId);
    if (!current) throw new Error(`Flow "${flowNodeId}" 가 존재하지 않습니다`);

    const next: FlowRunState = { ...current, ...updater(current) };
    state.flowStates.set(flowNodeId, next);
    return next;
  }

  updatePipeline(runId: string, status: PipelineStatus): PipelineRunState {
    const state = this.runs.get(runId);
    if (!state) throw new Error(`PipelineRun "${runId}" 가 존재하지 않습니다`);
    state.status = status;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      state.completedAt = new Date();
    }
    return state;
  }

  incrementMetrics(
    runId: string,
    deltas: { costUsd?: number; tokensIn?: number; tokensOut?: number },
  ): void {
    const state = this.runs.get(runId);
    if (!state) return;
    if (deltas.costUsd) state.totalCostUsd += deltas.costUsd;
    if (deltas.tokensIn) state.totalTokensIn += deltas.tokensIn;
    if (deltas.tokensOut) state.totalTokensOut += deltas.tokensOut;
  }

  listByStatus(runId: string, status: NodeStatus): NodeRunState[] {
    const state = this.runs.get(runId);
    if (!state) return [];
    return Array.from(state.nodes.values()).filter((n) => n.status === status);
  }

  listReady(runId: string): NodeRunState[] {
    return this.listByStatus(runId, 'ready');
  }

  listRunning(runId: string): NodeRunState[] {
    return this.listByStatus(runId, 'running');
  }

  isAllTerminal(runId: string): boolean {
    const state = this.runs.get(runId);
    if (!state) return false;
    for (const node of state.nodes.values()) {
      if (!isTerminal(node.status)) return false;
    }
    return true;
  }

  delete(runId: string): boolean {
    return this.runs.delete(runId);
  }

  size(): number {
    return this.runs.size;
  }
}

function isFlowType(type: string): boolean {
  return type === 'branch' || type === 'parallel' || type === 'loop' || type === 'gate';
}

function createFlowState(node: CompiledNode): FlowRunState {
  const type = node.spec.type as 'branch' | 'parallel' | 'loop' | 'gate';
  const base: FlowRunState = { flowNodeId: node.pathId, type };

  if (type === 'parallel') {
    const spec = node.spec as ParallelNodeSpec;
    const branchResults = new Map<string, 'pending'>();
    for (const branch of spec.branches ?? []) {
      branchResults.set(branch.id, 'pending');
    }
    return { ...base, branchResults: branchResults as FlowRunState['branchResults'] };
  }

  if (type === 'loop') {
    return { ...base, currentIteration: 0, completedIterations: 0, iterationResults: [] };
  }

  return base;
}
