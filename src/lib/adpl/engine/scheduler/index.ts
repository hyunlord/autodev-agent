import type { ExecutionPlan } from '../compiler/types';
import type { PipelineRunState } from '../state/types';
import type { StateStore } from '../state/store';
import type { EventBus } from '../events/bus';
import type { CancellationToken } from '../cancel/token';
import type { Worker, SchedulerResult, SchedulerOptions } from './types';
import type { NodeOutput } from '@/lib/adpl/types';
import type { FlowNodeOptions } from './flow-handler';
import type { LoopContext } from '../adapters/types';
import { isFlowNode, FlowRegistry, createDefaultFlowRegistry } from './flow-registry';
import { collectCompletedNodeOutputs } from '../worker/context-builder';

export class Scheduler {
  private readyQueue: string[] = [];
  private running = new Set<string>();
  private readonly maxConcurrent: number;
  private readonly defaultOnError: 'abort' | 'continue';
  private readonly debug: boolean;
  private readonly flowRegistry: FlowRegistry;
  private readonly resumeMode: boolean;
  private hasFailure = false;
  private fatalError: Error | null = null;
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
    this.flowRegistry = options.flowRegistry ?? createDefaultFlowRegistry();
    this.resumeMode = options.resumeMode ?? false;
  }

  async run(): Promise<SchedulerResult> {
    this.startTime = Date.now();

    await this.store.updatePipeline(this.state.id, 'running');
    this.eventBus.emit({
      type: 'run.started',
      timestamp: new Date(),
      runId: this.state.id,
      plan: this.plan,
    });

    if (!this.token.isCancelled) {
      if (this.resumeMode) {
        // Stage 6 F3 — pending 이면서 prereq 가 모두 만족된 모든 노드를 시드.
        // Fresh run 과 달리 root 만이 아닌 중간 노드도 ready 가 될 수 있다.
        for (const nodeId of this.plan.graph.allNodes) {
          const nodeState = await this.store.getNode(this.state.id, nodeId);
          if (nodeState?.status !== 'pending') continue;
          if (await this.allDependenciesSatisfied(nodeId)) {
            await this.markReady(nodeId);
          }
        }
      } else {
        for (const rootId of this.getRootNodeIds()) {
          await this.markReady(rootId);
        }
      }
    }

    while (!this.isDone()) {
      await this.schedulerTick();
      if (this.fatalError) throw this.fatalError;
    }

    await this.finalize();

    const result = this.buildResult();

    const pipelineStatus =
      result.status === 'completed' ? 'completed' as const :
      result.status === 'failed' ? 'failed' as const :
      'cancelled' as const;
    await this.store.updatePipeline(this.state.id, pipelineStatus);

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
      await this.cancelReadyNodes();
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
      void this.startExecution(nodeId);
    }

    if (this.running.size === 0) return;

    await this.waitForAnyComplete();
  }

  private async startExecution(nodeId: string): Promise<void> {
    // Mark node as running BEFORE any await to avoid a race where schedulerTick
    // (which calls `void startExecution(...)`) sees `running.size === 0` and
    // exits the loop before this method resumes past its first await.
    this.running.add(nodeId);

    try {
      await this.store.updateNode(this.state.id, nodeId, (n) => ({
        status: 'running',
        startedAt: new Date(),
        attemptNumber: n.attemptNumber + 1,
      }));

      const nodeState = await this.store.getNode(this.state.id, nodeId);
      const attempt = nodeState!.attemptNumber;
      this.eventBus.emit({
        type: 'node.started',
        timestamp: new Date(),
        runId: this.state.id,
        nodeId,
        attempt,
      });

      // executeNode 내부에서 worker crash 는 try/catch 로 failure 로 변환된다.
      // 여기서 catch 되는 건 handleNodeComplete 단계의 에러 — 이미 terminal 이므로 로깅만.
      this.executeNode(nodeId).catch((err) => {
        if (err instanceof Error && err.message.startsWith('CHECKPOINT_PERSIST_FAILED')) {
          this.fatalError = err;
          return;
        }
        if (this.debug) {
          console.error(`[Scheduler] handleNodeComplete threw for ${nodeId}:`, err);
        }
      });
    } catch (err) {
      // store.updateNode / store.getNode / eventBus.emit 이 throw 하면
      // running 에서 제거하고 노드를 failure 로 정리해야 스케줄러가 hang 하지 않는다.
      this.running.delete(nodeId);
      await this.handleNodeComplete(nodeId, {
        status: 'failure',
        error: {
          code: 'scheduler_internal_error',
          message: err instanceof Error ? err.message : String(err),
          category: 'persistent',
        },
      });
    }
  }

  /**
   * FlowNodeHandler 에 전달할 options 구성.
   * 기본 { runId, eventBus, token } 외에 $nodes 및 setLoopCtx 콜백 주입.
   *
   * FlowNodeOptions 타입은 flow-handler.ts 에서 정의되어 있어 (확장 불가),
   * 추가 필드는 as cast 로 전달. Handler 는 필요 시 `options as Record<string,unknown>` 로
   * 필드 추출.
   */
  private buildFlowHandlerOptions(): FlowNodeOptions {
    const $nodes = collectCompletedNodeOutputs(this.plan, this.state);
    const setLoopCtx = (loopNodePathId: string, ctx: LoopContext | null): void => {
      const flowState = this.state.flowStates.get(loopNodePathId);
      if (!flowState) return;
      if (ctx) {
        flowState.currentLoopCtx = ctx;
      } else {
        delete flowState.currentLoopCtx;
      }
    };
    const opts = {
      runId: this.state.id,
      eventBus: this.eventBus,
      token: this.token,
      $nodes,
      setLoopCtx,
    };
    return opts as FlowNodeOptions;
  }

  private async executeNode(nodeId: string): Promise<void> {
    const node = this.plan.nodes.get(nodeId);
    let output: NodeOutput;

    // worker/flow 경로만 catch 로 감싼다. handleNodeComplete 단계에서 발생한 에러는
    // 이미 node 가 terminal 상태일 수 있으므로 다시 handleNodeComplete(failure) 를 부르면
    // success→failure 같은 무효 전이로 이어진다. 이 단계의 에러는 상위 Promise.reject 로 전파.
    try {
      if (node && isFlowNode(node.spec.type) && this.flowRegistry.has(node.spec.type)) {
        // flow node → FlowNodeHandler 경로 (Executor.run() 수정 없음)
        const handler = this.flowRegistry.get(node.spec.type);
        output = await handler.handle(
          node.spec,
          nodeId,
          (subPathId) => this.runSubNodeDirectly(subPathId),
          this.buildFlowHandlerOptions(),
        );
      } else {
        // leaf node → Worker 경로 (기존)
        output = await this.worker.execute(nodeId, this.plan, this.state, this.token);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('CHECKPOINT_PERSIST_FAILED')) {
        throw err;
      }
      output = {
        status: 'failure',
        error: {
          code: 'worker_crash',
          message: err instanceof Error ? err.message : String(err),
          category: 'persistent',
        },
      };
    }

    await this.handleNodeComplete(nodeId, output);
  }

  /**
   * FlowNodeHandler 가 sub-node 를 직접 실행할 때 호출하는 콜백.
   * 상태 전이 (pending→ready→running→terminal) + node 이벤트 emit 담당.
   * Scheduler 의 ready queue 를 거치지 않음.
   *
   * Checkpoint policy: sub-node 완료(성공·실패 무관) 후 store.persist() 호출.
   * persist 실패는 CHECKPOINT_PERSIST_FAILED 에러로 throw — node.completed emit 후
   * re-throw 하여 waitForAnyComplete 를 깨운 뒤 executeNode catch → fatalError 경로로 전파.
   */
  private async runSubNodeDirectly(pathId: string): Promise<NodeOutput> {
    // 동적 서브노드(loop 반복 생성 pathId)는 컴파일 타임에 없을 수 있으므로 lazy 등록
    await this.store.registerDynamicNode(this.state.id, pathId);

    // pending → ready
    await this.store.updateNode(this.state.id, pathId, () => ({ status: 'ready' }));
    this.eventBus.emit({
      type: 'node.ready',
      timestamp: new Date(),
      runId: this.state.id,
      nodeId: pathId,
    });

    // ready → running
    await this.store.updateNode(this.state.id, pathId, (n) => ({
      status: 'running',
      startedAt: new Date(),
      attemptNumber: n.attemptNumber + 1,
    }));
    const runningNodeState = await this.store.getNode(this.state.id, pathId);
    const attempt = runningNodeState!.attemptNumber;
    this.eventBus.emit({
      type: 'node.started',
      timestamp: new Date(),
      runId: this.state.id,
      nodeId: pathId,
      attempt,
    });

    let output: NodeOutput;
    try {
      let subNode = this.plan.nodes.get(pathId);

      // 동적 loop 반복 pathId (예: pipeline.0.do.2.0) 는 plan 에 없을 수 있음.
      // loop handler 가 생성하는 패턴: {loopPathId}.do.{iterIdx}.{nodeIdx}
      // 컴파일 타임 template path:    {loopPathId}.do.{nodeIdx}
      // iterIdx 세그먼트를 제거하여 template 노드 찾아 plan 에 동적 등록.
      if (!subNode) {
        const templatePathId = resolveLoopTemplatePath(pathId);
        if (templatePathId) {
          const templateNode = this.plan.nodes.get(templatePathId);
          if (templateNode) {
            // 동적 pathId 로 template 노드를 plan.nodes 에 등록 (Worker 조회 가능하게)
            subNode = { ...templateNode, pathId };
            this.plan.nodes.set(pathId, subNode);
          }
        }
      }

      if (!subNode) {
        throw new Error(`Sub-node "${pathId}" not found in plan`);
      }

      if (isFlowNode(subNode.spec.type) && this.flowRegistry.has(subNode.spec.type)) {
        // 중첩 flow node — 재귀
        const handler = this.flowRegistry.get(subNode.spec.type);
        output = await handler.handle(
          subNode.spec,
          pathId,
          (innerPathId) => this.runSubNodeDirectly(innerPathId),
          this.buildFlowHandlerOptions(),
        );
      } else {
        output = await this.worker.execute(pathId, this.plan, this.state, this.token);
      }
    } catch (err) {
      output = {
        status: 'failure',
        error: {
          code: 'sub_node_crash',
          message: err instanceof Error ? err.message : String(err),
          category: 'persistent',
        },
      };
    }

    const targetStatus =
      output.status === 'success' ? 'success' as const :
      output.status === 'cancelled' ? 'cancelled' as const :
      'failure' as const;

    const preCompleteNodeState = await this.store.getNode(this.state.id, pathId);
    const startedAt = preCompleteNodeState?.startedAt;
    const durationMs = startedAt ? Date.now() - startedAt.getTime() : 0;

    await this.store.updateNode(this.state.id, pathId, () => ({
      status: targetStatus,
      completedAt: new Date(),
      output,
      error: output.error,
    }));

    let subPersistError: Error | null = null;
    try {
      await this.store.persist(this.state.id);
    } catch (persistErr) {
      const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
      subPersistError = new Error(
        `CHECKPOINT_PERSIST_FAILED: runId=${this.state.id} nodeId=${pathId} cause=${msg}`,
      );
      // emit 전에 설정해야 waitForAnyComplete resolve 후 run() 루프에서 즉시 감지됨
      this.fatalError = subPersistError;
    }

    this.eventBus.emit({
      type: 'node.completed',
      timestamp: new Date(),
      runId: this.state.id,
      nodeId: pathId,
      output,
      durationMs,
    });

    if (subPersistError) throw subPersistError;
    return output;
  }

  /**
   * 노드 완료 처리. 상태 갱신 후 DB persist.
   *
   * Checkpoint policy: 노드 완료(성공·실패 무관) 후 store.persist() 호출.
   * persist 실패는 CHECKPOINT_PERSIST_FAILED 에러로 throw — node.completed emit 후
   * re-throw 하여 waitForAnyComplete 를 깨운 뒤 startExecution catch → fatalError 경로로 전파.
   */
  private async handleNodeComplete(nodeId: string, output: NodeOutput): Promise<void> {
    this.running.delete(nodeId);

    const preCompleteNodeState = await this.store.getNode(this.state.id, nodeId);
    const startedAt = preCompleteNodeState?.startedAt;
    const durationMs = startedAt ? Date.now() - startedAt.getTime() : 0;

    const targetStatus =
      output.status === 'success' ? 'success' as const :
      output.status === 'failure' ? 'failure' as const :
      'cancelled' as const;

    await this.store.updateNode(this.state.id, nodeId, () => ({
      status: targetStatus,
      completedAt: new Date(),
      output,
      error: output.error,
    }));

    let persistError: Error | null = null;
    try {
      await this.store.persist(this.state.id);
    } catch (persistErr) {
      const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
      persistError = new Error(
        `CHECKPOINT_PERSIST_FAILED: runId=${this.state.id} nodeId=${nodeId} cause=${msg}`,
      );
      // emit 전에 설정해야 waitForAnyComplete resolve 후 run() 루프에서 즉시 감지됨
      this.fatalError = persistError;
    }

    if (targetStatus === 'failure') {
      this.hasFailure = true;
    }

    // unlockDependents 는 `node.completed` emit 이전에 완료되어야 한다.
    // emit 이 waitForAnyComplete 를 resolve 시키면 scheduler 가 즉시 isDone() 을 평가하므로,
    // 의존 노드를 ready 로 marking 하기 전에 loop 가 종료되면 후속 노드가 실행되지 못한다.
    if (
      !persistError &&
      (targetStatus === 'success' ||
        (targetStatus === 'failure' && this.defaultOnError === 'continue'))
    ) {
      await this.unlockDependents(nodeId);
    }

    this.eventBus.emit({
      type: 'node.completed',
      timestamp: new Date(),
      runId: this.state.id,
      nodeId,
      output,
      durationMs,
    });

    if (persistError) throw persistError;
  }

  private async unlockDependents(nodeId: string): Promise<void> {
    const dependents = this.plan.graph.forward.get(nodeId) ?? new Set<string>();
    for (const depId of dependents) {
      const depState = await this.store.getNode(this.state.id, depId);
      // 이미 terminal 이거나 ready/running 상태이면 skip
      if (!depState || depState.status !== 'pending') continue;
      if (await this.allDependenciesSatisfied(depId)) {
        await this.markReady(depId);
      }
    }
  }

  private async allDependenciesSatisfied(nodeId: string): Promise<boolean> {
    const prereqs = this.plan.graph.reverse.get(nodeId);
    if (!prereqs || prereqs.size === 0) return true;

    for (const prereqId of prereqs) {
      const s = await this.store.getNode(this.state.id, prereqId);
      if (!s) return false;
      if (s.status === 'success' || s.status === 'skipped') continue;
      if (s.status === 'failure' && this.defaultOnError === 'continue') continue;
      return false;
    }
    return true;
  }

  private async markReady(nodeId: string): Promise<void> {
    const current = await this.store.getNode(this.state.id, nodeId);
    if (!current || current.status !== 'pending') return;

    await this.store.updateNode(this.state.id, nodeId, () => ({ status: 'ready' }));
    this.readyQueue.push(nodeId);

    this.eventBus.emit({
      type: 'node.ready',
      timestamp: new Date(),
      runId: this.state.id,
      nodeId,
    });
  }

  private async cancelReadyNodes(): Promise<void> {
    while (this.readyQueue.length > 0) {
      const nodeId = this.readyQueue.shift()!;
      await this.store.updateNode(this.state.id, nodeId, () => ({
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
  private async finalize(): Promise<void> {
    const snapshot = Array.from(this.state.nodes.values());

    for (const nodeState of snapshot) {
      // pending/ready 노드만 정리. failure 는 isTerminal=false 이지만 이미 처리됨.
      if (nodeState.status !== 'pending' && nodeState.status !== 'ready') continue;

      const nodeId = nodeState.nodeId;

      if (this.token.isCancelled) {
        await this.store.updateNode(this.state.id, nodeId, () => ({
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
        await this.store.updateNode(this.state.id, nodeId, () => ({
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

/**
 * loop handler 가 생성하는 동적 pathId 에서 컴파일 타임 template pathId 를 복원.
 *
 * 패턴: {loopPathId}.do.{iterIdx}.{nodeIdx}
 * 템플릿: {loopPathId}.do.{nodeIdx}
 *
 * ".do." 세그먼트를 찾아 그 뒤의 iterIdx 를 제거한다.
 * 예: "pipeline.0.do.2.0" → "pipeline.0.do.0"
 *     "pipeline.0.do.1.1" → "pipeline.0.do.1"
 *
 * ".do." 가 없으면 null 반환 (loop 동적 pathId 아님).
 */
function resolveLoopTemplatePath(pathId: string): string | null {
  const doMarker = '.do.';
  const idx = pathId.indexOf(doMarker);
  if (idx === -1) return null;

  const loopPrefix = pathId.slice(0, idx); // e.g. "pipeline.0"
  const afterDo = pathId.slice(idx + doMarker.length); // e.g. "2.0"
  const parts = afterDo.split('.');
  if (parts.length < 2) return null;

  // parts[0] = iterIdx, parts[1..] = nodeIdx (and possible nested)
  const nodeIdxParts = parts.slice(1);
  return `${loopPrefix}${doMarker}${nodeIdxParts.join('.')}`;
}
