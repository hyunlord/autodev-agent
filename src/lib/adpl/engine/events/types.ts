import type { ExecutionPlan } from '../compiler/types';
import type { NodeOutput } from '@/lib/adpl/types';

export type EngineEvent =
  | RunStartedEvent
  | RunCompletedEvent
  | RunCancelledEvent
  | RunFailedEvent
  | NodeReadyEvent
  | NodeStartedEvent
  | NodeCompletedEvent
  | NodeRetryEvent
  | NodeSkippedEvent
  | NodeCancelledEvent
  | BranchTakenEvent
  | ParallelBranchDoneEvent
  | FlowParallelStartEvent
  | FlowBranchCompleteEvent
  | FlowParallelCompleteEvent
  | FlowBranchSelectEvent
  | LoopIterationStartEvent
  | LoopIterationDoneEvent
  | FlowLoopStartEvent
  | FlowLoopIterationEvent
  | FlowLoopCompleteEvent
  | FlowLoopIterationFailedEvent
  | FlowLoopBreakEvent
  | GateOpenedEvent
  | GateDecidedEvent
  | AgentTokenEvent
  | AgentToolCallEvent
  | AgentFallbackEvent
  | AgentInputDegradedEvent
  | ShellOutputEvent
  | HttpRequestEvent
  | HttpResponseEvent
  | HttpRetryEvent
  | WebhookSentEvent
  | WebhookRateLimitedEvent;

interface EventBase {
  timestamp: Date;
  runId: string;
}

export interface RunStartedEvent extends EventBase {
  type: 'run.started';
  plan: ExecutionPlan;
}
export interface RunCompletedEvent extends EventBase {
  type: 'run.completed';
  status: 'success' | 'failure' | 'cancelled';
  durationMs: number;
}
export interface RunCancelledEvent extends EventBase {
  type: 'run.cancelled';
  reason: string;
}
export interface RunFailedEvent extends EventBase {
  type: 'run.failed';
  reason: string;
  failedNodeId?: string;
}
export interface NodeReadyEvent extends EventBase {
  type: 'node.ready';
  nodeId: string;
}
export interface NodeStartedEvent extends EventBase {
  type: 'node.started';
  nodeId: string;
  attempt: number;
}
export interface NodeCompletedEvent extends EventBase {
  type: 'node.completed';
  nodeId: string;
  output: NodeOutput;
  durationMs: number;
}
export interface NodeRetryEvent extends EventBase {
  type: 'node.retry';
  nodeId: string;
  attempt: number;
  reason: string;
}
export interface NodeSkippedEvent extends EventBase {
  type: 'node.skipped';
  nodeId: string;
  reason: string;
}
export interface NodeCancelledEvent extends EventBase {
  type: 'node.cancelled';
  nodeId: string;
}
export interface BranchTakenEvent extends EventBase {
  type: 'flow.branch.taken';
  nodeId: string;
  caseId: string;
}
export interface ParallelBranchDoneEvent extends EventBase {
  type: 'flow.parallel.branch_done';
  parallelId: string;
  branchId: string;
  status: 'success' | 'failure' | 'cancelled';
}
export interface FlowParallelStartEvent extends EventBase {
  type: 'flow.parallel.start';
  parallelId: string;
  branchCount: number;
}
export interface FlowBranchCompleteEvent extends EventBase {
  type: 'flow.branch.complete';
  parallelId: string;
  branchId: string;
  ok: boolean;
  error?: string;
}
export interface FlowParallelCompleteEvent extends EventBase {
  type: 'flow.parallel.complete';
  parallelId: string;
  branchCount: number;
  failureCount: number;
}
export interface FlowBranchSelectEvent extends EventBase {
  type: 'flow.branch.select';
  branchNodeId: string;
  selectedCase: string | null;
}
export interface FlowLoopStartEvent extends EventBase {
  type: 'flow.loop.start';
  parentId: string;
  kind: 'forEach' | 'while';
}
export interface FlowLoopIterationEvent extends EventBase {
  type: 'flow.loop.iteration';
  parentId: string;
  index: number;
}
export interface FlowLoopCompleteEvent extends EventBase {
  type: 'flow.loop.complete';
  parentId: string;
  iterationCount: number;
  terminated: 'complete' | 'max_iterations' | 'error' | 'break' | 'complete-with-errors';
}
export interface FlowLoopIterationFailedEvent extends EventBase {
  type: 'flow.loop.iteration.failed';
  parentId: string;
  index: number;
  error: string;
}
export interface FlowLoopBreakEvent extends EventBase {
  type: 'flow.loop.break';
  parentId: string;
  index: number;
}
export interface LoopIterationStartEvent extends EventBase {
  type: 'flow.loop.iteration_start';
  loopId: string;
  index: number;
}
export interface LoopIterationDoneEvent extends EventBase {
  type: 'flow.loop.iteration_done';
  loopId: string;
  index: number;
  status: 'success' | 'failure' | 'cancelled';
}
export interface GateOpenedEvent extends EventBase {
  type: 'flow.gate.opened';
  gateId: string;
  waitId: string;
}
export interface GateDecidedEvent extends EventBase {
  type: 'flow.gate.decided';
  gateId: string;
  decision: string;
  decidedBy: string;
}
export interface AgentTokenEvent extends EventBase {
  type: 'agent.token';
  nodeId: string;
  delta: string;
}
export interface AgentToolCallEvent extends EventBase {
  type: 'agent.tool_call';
  nodeId: string;
  tool: string;
  args: unknown;
}
export interface AgentFallbackEvent extends EventBase {
  type: 'agent.fallback';
  nodeId: string;
  from: string;
  to: string;
  reason: string;
}

export interface AgentInputDegradedEvent extends EventBase {
  type: 'agent.input_degraded';
  nodeId: string;
  kind: 'prompt-truncated';
  originalSize: number;
  keptSize: number;
  severity: 'warning' | 'error';
  reason: string;
}

export interface ShellOutputEvent extends EventBase {
  type: 'shell.output';
  nodeId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}

export interface HttpRequestEvent extends EventBase {
  type: 'http.request';
  url: string;
  method: string;
  attempt: number;
}

export interface HttpResponseEvent extends EventBase {
  type: 'http.response';
  status: number;
  bodySize: number;
}

export interface HttpRetryEvent extends EventBase {
  type: 'http.retry';
  attempt: number;
  reason: 'status' | 'network';
  backoffMs: number;
}

export interface WebhookSentEvent extends EventBase {
  type: 'webhook.sent';
  provider: 'slack' | 'discord' | 'teams' | 'generic';
  status: number;
}

export interface WebhookRateLimitedEvent extends EventBase {
  type: 'webhook.rate_limited';
  provider: string;
  waitMs: number;
}

export type EngineEventType = EngineEvent['type'];
export type EventHandler<T extends EngineEvent = EngineEvent> = (
  event: T,
) => void | Promise<void>;
export type EventOfType<T extends EngineEventType> = Extract<EngineEvent, { type: T }>;
