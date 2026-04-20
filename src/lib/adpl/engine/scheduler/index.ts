import type { ExecutionPlan } from '../compiler/types';
import type { PipelineRunState } from '../state/types';
import type { StateStore } from '../state/store';
import type { EventBus } from '../events/bus';
import type { CancellationToken } from '../cancel/token';
import type { Worker, SchedulerResult, SchedulerOptions } from './types';
import type { NodeOutput } from '@/lib/adpl/types';

export class Scheduler {
  private readyQueue: string[] = [];
  private running = new Set<string>();
  private readonly maxConcurrent: number;
  private readonly defaultOnError: 'abort' | 'continue';
  private readonly debug: boolean;
  private hasFailure = false;
  private startTime = 0;

  constructor(
    private readonly plan: ExecutionPlan,
    private readonly state: PipelineRunState,
    private readonly store: StateStore,
    private readonly worker: Worker,
    private readonly eventBus: EventBus,
    private readonly token: CancellationToken,
    options: SchedulerOptions = {},
  ) {
    this.maxConcurrent = plan.context.settings.maxParallel;
    this.defaultOnError = options.defaultOnError ?? 'abort';
    this.debug = options.debug ?? false;
  }

  async run(): Promise<SchedulerResult> {
    this.startTime = Date.now();

    this.store.updatePipeline(this.state.id, 'running');
    this.eventBus.emit({
      type: 'run.started',
      timestamp: new Date(),
      runId: this.state.id,
      plan: this.plan,
    });

    if (!this.token.isCancelled) {
      for (const rootId of this.getRootNodeIds()) {
        this.markReady(rootId);
      }
    }

    while (!this.isDone()) {
      await this.schedulerTick();
    }

    this.finalize();

    const result = this.buildResult();

    const pipelineStatus =
      result.status === 'completed' ? 'completed' as const :
      result.status === 'failed' ? 'failed' as const :
      'cancelled' as const;
    this.store.updatePipeline(this.state.id, pipelineStatus);

    const eventStatus =
      result.status === 'completed' ? 'success' as const :
      result.status === 'failed' ? 'failure' as const :
      'cancelled' as const;
    this.eventBus.emit({
      type: 'run.completed',
      timestamp: new Date(),
      runId: this.state.id,
      status: eventStatus,
      durationMs: result.durationMs,
    });

    return result;
  }

  private async schedulerTick(): Promise<void> {
    const shouldAbort =
      this.token.isCancelled ||
      (this.hasFailure && this.defaultOnError === 'abort');

    if (shouldAbort) {
      this.cancelReadyNodes();
      if (this.running.size > 0) {
        await this.waitForAnyComplete();
      }
      return;
    }

    while (
      this.running.size < this.maxConcurrent &&
      this.readyQueue.length > 0 &&
      !this.token.isCancelled
    ) {
      const nodeId = this.readyQueue.shift()!;
      this.startExecution(nodeId);
    }

    if (this.running.size === 0) return;

    await this.waitForAnyComplete();
  }

  private startExecution(nodeId: string): void {
    this.store.updateNode(this.state.id, nodeId, (n) => ({
      status: 'running',
      startedAt: new Date(),
      attemptNumber: n.attemptNumber + 1,
    }));

    this.running.add(nodeId);

    const attempt = this.store.getNode(this.state.id, nodeId)!.attemptNumber;
    this.eventBus.emit({
      type: 'node.started',
      timestamp: new Date(),
      runId: this.state.id,
      nodeId,
      attempt,
    });

    this.executeNode(nodeId).catch((err) => {
      if (this.debug) console.error(`[Scheduler] Worker threw for ${nodeId}:`, err);
      this.handleNodeComplete(nodeId, {
        status: 'failure',
        error: {
          code: 'worker_crash',
          message: err instanceof Error ? err.message : String(err),
          category: 'persistent',
        },
      });
    });
  }

  private async executeNode(nodeId: string): Promise<void> {
    const output = await this.worker.execute(nodeId, this.plan, this.state, this.token);
    this.handleNodeComplete(nodeId, output);
  }

  private handleNodeComplete(nodeId: string, output: NodeOutput): void {
    this.running.delete(nodeId);

    const startedAt = this.store.getNode(this.state.id, nodeId)?.startedAt;
    const durationMs = startedAt ? Date.now() - startedAt.getTime() : 0;

    const targetStatus =
      output.status === 'success' ? 'success' as const :
      output.status === 'failure' ? 'failure' as const :
      'cancelled' as const;

    this.store.updateNode(this.state.id, nodeId, () => ({
      status: targetStatus,
      completedAt: new Date(),
      output,
      error: output.error,
    }));

    this.eventBus.emit({
      type: 'node.completed',
      timestamp: new Date(),
      runId: this.state.id,
      nodeId,
      output,
      durationMs,
    });

    if (targetStatus === 'failure') {
      this.hasFailure = true;
    }

    if (
      targetStatus === 'success' ||
      (targetStatus === 'failure' && this.defaultOnError === 'continue')
    ) {
      this.unlockDependents(nodeId);
    }
  }

  private unlockDependents(nodeId: string): void {
    const dependents = this.plan.graph.forward.get(nodeId) ?? new Set<string>();
    for (const depId of dependents) {
      const depState = this.store.getNode(this.state.id, depId);
      if (!depState || depState.status !== 'pending') continue;
      if (this.allDependenciesSatisfied(depId)) {
        this.markReady(depId);
      }
    }
  }

  private allDependenciesSatisfied(nodeId: string): boolean {
    const prereqs = this.plan.graph.reverse.get(nodeId);
    if (!prereqs || prereqs.size === 0) return true;

    for (const prereqId of prereqs) {
      const s = this.store.getNode(this.state.id, prereqId);
      if (!s) return false;
      if (s.status === 'success' || s.status === 'skipped') continue;
      if (s.status === 'failure' && this.defaultOnError === 'continue') continue;
      return false;
    }
    return true;
  }

  private markReady(nodeId: string): void {
    const current = this.store.getNode(this.state.id, nodeId);
    if (!current || current.status !== 'pending') return;

    this.store.updateNode(this.state.id, nodeId, () => ({ status: 'ready' }));
    this.readyQueue.push(nodeId);

    this.eventBus.emit({
      type: 'node.ready',
      timestamp: new Date(),
      runId: this.state.id,
      nodeId,
    });
  }

  private cancelReadyNodes(): void {
    while (this.readyQueue.length > 0) {
      const nodeId = this.readyQueue.shift()!;
      this.store.updateNode(this.state.id, nodeId, () => ({
        status: 'cancelled',
        completedAt: new Date(),
      }));
      this.eventBus.emit({
        type: 'node.cancelled',
        timestamp: new Date(),
        runId: this.state.id,
        nodeId,
      });
    }
  }

  private waitForAnyComplete(): Promise<void> {
    return new Promise((resolve) => {
      let unsubCancel: (() => void) | undefined;

      const unsubscribe = this.eventBus.on('node.completed', (event) => {
        if (event.runId !== this.state.id) return;
        unsubscribe();
        unsubCancel?.();
        resolve();
      });

      unsubCancel = this.token.onCancel(() => {
        unsubscribe();
        resolve();
      });
    });
  }

  /**
   * 메인 루프 후 terminal 상태가 아닌 노드 정리.
   * - cancel 요청: pending/ready → cancelled
   * - abort 정책: pending → skipped, ready → cancelled (ready→skipped 전이 무효)
   */
  private finalize(): void {
    const snapshot = Array.from(this.state.nodes.values());

    for (const nodeState of snapshot) {
      // pending/ready 노드만 정리. failure 는 isTerminal=false 이지만 이미 처리됨.
      if (nodeState.status !== 'pending' && nodeState.status !== 'ready') continue;

      const nodeId = nodeState.nodeId;

      if (this.token.isCancelled) {
        this.store.updateNode(this.state.id, nodeId, () => ({
          status: 'cancelled',
          completedAt: new Date(),
        }));
        this.eventBus.emit({
          type: 'node.cancelled',
          timestamp: new Date(),
          runId: this.state.id,
          nodeId,
        });
      } else if (this.hasFailure && this.defaultOnError === 'abort') {
        // pending → skipped (valid), ready → cancelled (ready→skipped 무효)
        const targetStatus = nodeState.status === 'pending' ? 'skipped' as const : 'cancelled' as const;
        this.store.updateNode(this.state.id, nodeId, () => ({
          status: targetStatus,
          completedAt: new Date(),
        }));
        if (targetStatus === 'skipped') {
          this.eventBus.emit({
            type: 'node.skipped',
            timestamp: new Date(),
            runId: this.state.id,
            nodeId,
            reason: 'upstream failure (abort policy)',
          });
        } else {
          this.eventBus.emit({
            type: 'node.cancelled',
            timestamp: new Date(),
            runId: this.state.id,
            nodeId,
          });
        }
      }
    }
  }

  private getRootNodeIds(): string[] {
    return this.plan.graph.allNodes.filter((nodeId) => {
      const prereqs = this.plan.graph.reverse.get(nodeId);
      return !prereqs || prereqs.size === 0;
    });
  }

  private isDone(): boolean {
    return this.readyQueue.length === 0 && this.running.size === 0;
  }

  private buildResult(): SchedulerResult {
    let completed = 0, failed = 0, skipped = 0, cancelled = 0;
    for (const node of this.state.nodes.values()) {
      if (node.status === 'success') completed++;
      else if (node.status === 'failure') failed++;
      else if (node.status === 'skipped') skipped++;
      else if (node.status === 'cancelled') cancelled++;
    }

    let status: SchedulerResult['status'];
    if (this.token.isCancelled || cancelled > 0) {
      status = 'cancelled';
    } else if (failed > 0) {
      status = 'failed';
    } else {
      status = 'completed';
    }

    return {
      status,
      completedNodes: completed,
      failedNodes: failed,
      skippedNodes: skipped,
      cancelledNodes: cancelled,
      durationMs: Date.now() - this.startTime,
    };
  }
}
