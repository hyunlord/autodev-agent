import type { PipelineEvent } from '@/lib/types';
import type { ExecutionContext, ExecutionOptions } from '../types';
import type { AgentFallbackEvent, AgentTokenEvent, AgentInputDegradedEvent } from '../../events/types';

export function makeOnProgress(
  ctx: ExecutionContext,
  options: ExecutionOptions,
): (event: PipelineEvent) => void {
  const runId = (ctx.$task as any)?.id ?? 'unknown';
  const nodeId = ctx.$self?.pathId ?? 'unknown';

  return (event: PipelineEvent) => {
    if (event.type === 'log') {
      const tokenEvent: AgentTokenEvent = {
        type: 'agent.token',
        timestamp: new Date(),
        runId,
        nodeId,
        delta: event.message,
      };
      options.eventBus.emit(tokenEvent);
    }
  };
}

export function emitFallback(
  ctx: ExecutionContext,
  options: ExecutionOptions,
  from: string,
  to: string,
  reason: string,
): void {
  const runId = (ctx.$task as any)?.id ?? 'unknown';
  const nodeId = ctx.$self?.pathId ?? 'unknown';

  const fallbackEvent: AgentFallbackEvent = {
    type: 'agent.fallback',
    timestamp: new Date(),
    runId,
    nodeId,
    from,
    to,
    reason,
  };
  options.eventBus.emit(fallbackEvent);
}

export function emitInputDegraded(
  ctx: ExecutionContext,
  options: ExecutionOptions,
  kind: 'prompt-truncated',
  originalSize: number,
  keptSize: number,
  reason: string,
  severity: 'warning' | 'error' = 'warning',
): void {
  const runId = (ctx.$task as any)?.id ?? 'unknown';
  const nodeId = ctx.$self?.pathId ?? 'unknown';

  const event: AgentInputDegradedEvent = {
    type: 'agent.input_degraded',
    timestamp: new Date(),
    runId,
    nodeId,
    kind,
    originalSize,
    keptSize,
    severity,
    reason,
  };
  options.eventBus.emit(event);
}
