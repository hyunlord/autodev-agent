import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { pipelineRunState } from '@/lib/db/schema';
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

/**
 * Serialized shape of a NodeRunState — Date 필드를 ISO 문자열로 저장.
 */
interface SerializedNodeRunState extends Omit<NodeRunState, 'startedAt' | 'completedAt'> {
  startedAt?: string;
  completedAt?: string;
}

/**
 * Serialized shape of a FlowRunState — Map(branchResults) 를 plain object 로 저장.
 */
interface SerializedFlowRunState extends Omit<FlowRunState, 'branchResults'> {
  branchResults?: Record<string, 'pending' | 'running' | 'success' | 'failure' | 'cancelled'>;
}

/**
 * Serialized shape of a PipelineRunState — Map 타입을 plain object 로, Date 를 ISO 문자열로 저장.
 */
interface SerializedPipelineRunState {
  id: string;
  executionPlanId: string;
  status: PipelineStatus;
  nodes: Record<string, SerializedNodeRunState>;
  flowStates: Record<string, SerializedFlowRunState>;
  startedAt: string;
  completedAt?: string;
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

export class StateStore {
  private runs = new Map<string, PipelineRunState>();
  private versions = new Map<string, number>();

  async create(plan: ExecutionPlan): Promise<PipelineRunState> {
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
    return Promise.resolve(state);
  }

  async get(runId: string): Promise<PipelineRunState | null> {
    return Promise.resolve(this.runs.get(runId) ?? null);
  }

  async getNode(runId: string, nodeId: string): Promise<NodeRunState | null> {
    return Promise.resolve(this.runs.get(runId)?.nodes.get(nodeId) ?? null);
  }

  async getFlow(runId: string, flowNodeId: string): Promise<FlowRunState | null> {
    return Promise.resolve(this.runs.get(runId)?.flowStates.get(flowNodeId) ?? null);
  }

  /**
   * 동적 서브노드 등록 — loop 반복 실행 시 컴파일 타임에 없는 pathId 를 런타임에 추가.
   * 이미 존재하는 경우 무시 (idempotent).
   */
  async registerDynamicNode(runId: string, nodeId: string): Promise<void> {
    const state = this.runs.get(runId);
    if (!state) throw new Error(`PipelineRun "${runId}" 가 존재하지 않습니다`);
    if (!state.nodes.has(nodeId)) {
      state.nodes.set(nodeId, { nodeId, status: 'pending', attemptNumber: 0 });
    }
    return Promise.resolve();
  }

  async updateNode(
    runId: string,
    nodeId: string,
    updater: (current: NodeRunState) => Partial<NodeRunState>,
  ): Promise<NodeRunState> {
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
    return Promise.resolve(next);
  }

  async updateFlow(
    runId: string,
    flowNodeId: string,
    updater: (current: FlowRunState) => Partial<FlowRunState>,
  ): Promise<FlowRunState> {
    const state = this.runs.get(runId);
    if (!state) throw new Error(`PipelineRun "${runId}" 가 존재하지 않습니다`);
    const current = state.flowStates.get(flowNodeId);
    if (!current) throw new Error(`Flow "${flowNodeId}" 가 존재하지 않습니다`);

    const next: FlowRunState = { ...current, ...updater(current) };
    state.flowStates.set(flowNodeId, next);
    return Promise.resolve(next);
  }

  async updatePipeline(runId: string, status: PipelineStatus): Promise<PipelineRunState> {
    const state = this.runs.get(runId);
    if (!state) throw new Error(`PipelineRun "${runId}" 가 존재하지 않습니다`);
    state.status = status;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      state.completedAt = new Date();
    }
    return Promise.resolve(state);
  }

  async incrementMetrics(
    runId: string,
    deltas: { costUsd?: number; tokensIn?: number; tokensOut?: number },
  ): Promise<void> {
    const state = this.runs.get(runId);
    if (!state) return Promise.resolve();
    if (deltas.costUsd) state.totalCostUsd += deltas.costUsd;
    if (deltas.tokensIn) state.totalTokensIn += deltas.tokensIn;
    if (deltas.tokensOut) state.totalTokensOut += deltas.tokensOut;
    return Promise.resolve();
  }

  async listByStatus(runId: string, status: NodeStatus): Promise<NodeRunState[]> {
    const state = this.runs.get(runId);
    if (!state) return Promise.resolve([]);
    return Promise.resolve(
      Array.from(state.nodes.values()).filter((n) => n.status === status),
    );
  }

  async listReady(runId: string): Promise<NodeRunState[]> {
    return this.listByStatus(runId, 'ready');
  }

  async listRunning(runId: string): Promise<NodeRunState[]> {
    return this.listByStatus(runId, 'running');
  }

  async isAllTerminal(runId: string): Promise<boolean> {
    const state = this.runs.get(runId);
    if (!state) return Promise.resolve(false);
    for (const node of state.nodes.values()) {
      if (!isTerminal(node.status)) return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }

  async delete(runId: string): Promise<boolean> {
    const result = this.runs.delete(runId);
    this.versions.delete(runId);
    return Promise.resolve(result);
  }

  async size(): Promise<number> {
    return Promise.resolve(this.runs.size);
  }

  /**
   * 현재 메모리 상태를 DB(pipeline_run_state) 에 저장.
   * Optimistic concurrency: version 이 일치하는 경우에만 update.
   * 충돌 시 `STATE_CONFLICT: <runId>` 에러를 throw.
   */
  async persist(runId: string): Promise<void> {
    const state = this.runs.get(runId);
    if (!state) return;

    const stateJson = JSON.stringify(serializePipelineRunState(state));
    const updatedAt = new Date().toISOString();
    const currentVersion = this.versions.get(runId) ?? 0;
    const nextVersion = currentVersion + 1;

    const existing = db
      .select()
      .from(pipelineRunState)
      .where(eq(pipelineRunState.runId, runId))
      .get();

    if (existing) {
      const result = db
        .update(pipelineRunState)
        .set({ stateJson, version: nextVersion, updatedAt })
        .where(
          and(
            eq(pipelineRunState.runId, runId),
            eq(pipelineRunState.version, currentVersion),
          ),
        )
        .run();
      if (result.changes === 0) {
        throw new Error(
          `STATE_CONFLICT: ${runId} (expected version ${currentVersion})`,
        );
      }
    } else {
      db.insert(pipelineRunState)
        .values({ runId, stateJson, version: 1, updatedAt })
        .run();
    }

    this.versions.set(runId, nextVersion);
  }

  /**
   * DB 에서 runId 로 저장된 PipelineRunState 를 읽어 새 StateStore 인스턴스를 복원.
   * 행이 없으면 `RUN_STATE_NOT_FOUND: <runId>` 에러 throw.
   */
  static async restore(runId: string): Promise<StateStore> {
    const row = db
      .select()
      .from(pipelineRunState)
      .where(eq(pipelineRunState.runId, runId))
      .get();
    if (!row) throw new Error(`RUN_STATE_NOT_FOUND: ${runId}`);

    const state = deserializePipelineRunState(
      JSON.parse(row.stateJson) as SerializedPipelineRunState,
    );
    const store = new StateStore();
    store.runs.set(runId, state);
    store.versions.set(runId, row.version);
    return store;
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

function serializeNodeRunState(node: NodeRunState): SerializedNodeRunState {
  return {
    ...node,
    startedAt: node.startedAt ? node.startedAt.toISOString() : undefined,
    completedAt: node.completedAt ? node.completedAt.toISOString() : undefined,
  };
}

function deserializeNodeRunState(node: SerializedNodeRunState): NodeRunState {
  const { startedAt, completedAt, ...rest } = node;
  const result: NodeRunState = { ...rest };
  if (startedAt) result.startedAt = new Date(startedAt);
  if (completedAt) result.completedAt = new Date(completedAt);
  return result;
}

function serializeFlowRunState(flow: FlowRunState): SerializedFlowRunState {
  const { branchResults, ...rest } = flow;
  const result: SerializedFlowRunState = { ...rest };
  if (branchResults) {
    const obj: Record<string, 'pending' | 'running' | 'success' | 'failure' | 'cancelled'> = {};
    for (const [k, v] of branchResults.entries()) {
      obj[k] = v;
    }
    result.branchResults = obj;
  }
  return result;
}

function deserializeFlowRunState(flow: SerializedFlowRunState): FlowRunState {
  const { branchResults, ...rest } = flow;
  const result: FlowRunState = { ...rest };
  if (branchResults) {
    const map = new Map<string, 'pending' | 'running' | 'success' | 'failure' | 'cancelled'>();
    for (const [k, v] of Object.entries(branchResults)) {
      map.set(k, v);
    }
    result.branchResults = map;
  }
  return result;
}

export function serializePipelineRunState(state: PipelineRunState): SerializedPipelineRunState {
  const nodes: Record<string, SerializedNodeRunState> = {};
  for (const [k, v] of state.nodes.entries()) {
    nodes[k] = serializeNodeRunState(v);
  }
  const flowStates: Record<string, SerializedFlowRunState> = {};
  for (const [k, v] of state.flowStates.entries()) {
    flowStates[k] = serializeFlowRunState(v);
  }
  return {
    id: state.id,
    executionPlanId: state.executionPlanId,
    status: state.status,
    nodes,
    flowStates,
    startedAt: state.startedAt.toISOString(),
    completedAt: state.completedAt ? state.completedAt.toISOString() : undefined,
    totalCostUsd: state.totalCostUsd,
    totalTokensIn: state.totalTokensIn,
    totalTokensOut: state.totalTokensOut,
  };
}

export function deserializePipelineRunState(serialized: SerializedPipelineRunState): PipelineRunState {
  const nodes = new Map<string, NodeRunState>();
  for (const [k, v] of Object.entries(serialized.nodes)) {
    nodes.set(k, deserializeNodeRunState(v));
  }
  const flowStates = new Map<string, FlowRunState>();
  for (const [k, v] of Object.entries(serialized.flowStates)) {
    flowStates.set(k, deserializeFlowRunState(v));
  }
  const state: PipelineRunState = {
    id: serialized.id,
    executionPlanId: serialized.executionPlanId,
    status: serialized.status,
    nodes,
    flowStates,
    startedAt: new Date(serialized.startedAt),
    totalCostUsd: serialized.totalCostUsd,
    totalTokensIn: serialized.totalTokensIn,
    totalTokensOut: serialized.totalTokensOut,
  };
  if (serialized.completedAt) state.completedAt = new Date(serialized.completedAt);
  return state;
}
