import type { NodeSpec, NodeOutput, TaskContext, ProjectContext, TriggerContext } from '@/lib/adpl/types';
import type { CompiledNode } from '../compiler/types';
import type { EventBus } from '../events/bus';

export interface LoopContext {
  index: number;
  total: number;
  isFirst: boolean;
  isLast: boolean;
  [as: string]: unknown;
}

export interface FlowContext {
  parentUserId: string;
  parentType: string;
}

/**
 * Adapter 실행 시 주입되는 런타임 컨텍스트.
 * Worker 가 Compiler 결과 + runtime 상태를 조합하여 조립.
 */
export interface ExecutionContext {
  $task: TaskContext;
  $project: ProjectContext;
  $trigger: TriggerContext;
  $env: Record<string, string>;
  $now: Date;
  $self: CompiledNode;
  $nodes: Record<string, NodeOutput>;
  $prev: NodeOutput | null;
  $loop: LoopContext | null;
  $flow: FlowContext | null;
  $variables: Record<string, unknown>;
}

export interface ValidationError {
  field?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

import type { CancellationToken } from '../cancel/token';
export type { CancellationToken, CancellationError } from '../cancel/token';

export type { EngineEvent, EngineEventType, EventHandler, EventOfType } from '../events/types';
export type { EventBus as IEventBus } from '../events/bus';

export interface ExecutionOptions {
  cancellationToken: CancellationToken;
  eventBus: EventBus;
  /** Timeout (ms). 0 = 제한 없음 */
  timeoutMs: number;
  /** 재귀 depth (flow adapter 가 내부 실행 시) */
  depth?: number;
}

/**
 * 모든 노드 타입이 구현하는 계약.
 */
export interface NodeAdapter<Spec extends NodeSpec = NodeSpec> {
  readonly type: string;
  defaultTimeout(): number;
  validate(spec: Spec): ValidationResult;
  execute(spec: Spec, context: ExecutionContext, options: ExecutionOptions): Promise<NodeOutput>;
}
