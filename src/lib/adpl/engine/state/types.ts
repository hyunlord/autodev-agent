import type { NodeStatus, NodeOutput, NodeError } from '@/lib/adpl/types';

export type { NodeStatus } from '@/lib/adpl/types';

export type PipelineStatus =
  | 'initializing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface NodeRunState {
  nodeId: string;
  status: NodeStatus;
  attemptNumber: number;
  startedAt?: Date;
  completedAt?: Date;
  output?: NodeOutput;
  error?: NodeError;
  parentFlowId?: string;
  iterationIndex?: number;
  branchIndex?: number;
  caseId?: string;
}

export interface FlowRunState {
  flowNodeId: string;
  type: 'branch' | 'parallel' | 'loop' | 'gate';
  takenCaseId?: string;
  branchResults?: Map<string, 'pending' | 'running' | 'success' | 'failure' | 'cancelled'>;
  currentIteration?: number;
  completedIterations?: number;
  iterationResults?: NodeOutput[];
  gateWaitId?: string;
  decision?: string;
}

export interface PipelineRunState {
  id: string;
  executionPlanId: string;
  status: PipelineStatus;
  nodes: Map<string, NodeRunState>;
  flowStates: Map<string, FlowRunState>;
  startedAt: Date;
  completedAt?: Date;
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

export class InvalidTransitionError extends Error {
  constructor(
    public from: NodeStatus,
    public to: NodeStatus,
    public nodeId: string,
  ) {
    super(`노드 "${nodeId}": 유효하지 않은 상태 전이 ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}
