import type { ParallelNodeSpec } from '@/lib/adpl/types/nodes/parallel';
import type { NodeOutput } from '@/lib/adpl/types';
import type { FlowNodeHandler, FlowNodeOptions, RunSubNodeFn } from '../flow-handler';

function createSemaphore(max: number): { acquire(): Promise<void>; release(): void } {
  let active = 0;
  const queue: Array<() => void> = [];

  return {
    async acquire() {
      if (active < max) {
        active++;
        return;
      }
      return new Promise<void>((resolve) => queue.push(resolve));
    },
    release() {
      const next = queue.shift();
      if (next) {
        // slot 을 다음 대기자에게 직접 이전 (active 는 그대로)
        next();
      } else {
        active--;
      }
    },
  };
}

interface BranchResult {
  branchId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export const parallelHandler: FlowNodeHandler<ParallelNodeSpec> = {
  type: 'parallel',

  async handle(spec, nodePathId, runSubNode, options): Promise<NodeOutput> {
    const { eventBus, token, runId } = options;
    const branches = spec.branches ?? [];
    const continueOnFailure = spec.onError === 'continue';
    const maxConcurrent = Math.max(1, spec.maxConcurrent ?? (branches.length || 1));

    eventBus.emit({
      type: 'flow.parallel.start',
      timestamp: new Date(),
      runId,
      parallelId: nodePathId,
      branchCount: branches.length,
    });

    if (branches.length === 0) {
      eventBus.emit({
        type: 'flow.parallel.complete',
        timestamp: new Date(),
        runId,
        parallelId: nodePathId,
        branchCount: 0,
        failureCount: 0,
      });
      return { status: 'success', data: { status: 'completed', branches: {} } };
    }

    const semaphore = createSemaphore(maxConcurrent);
    // fail-fast: 첫 실패 branch 가 설정 → 이후 branch 는 시작 안 함
    let aborted = false;

    const branchPromises: Promise<BranchResult>[] = branches.map(
      async (branch, branchIdx): Promise<BranchResult> => {
        await semaphore.acquire();
        try {
          if (aborted || token.isCancelled) {
            const reason = token.isCancelled ? 'cancelled' : 'aborted by sibling failure';
            eventBus.emit({
              type: 'flow.branch.complete',
              timestamp: new Date(),
              runId,
              parallelId: nodePathId,
              branchId: branch.id,
              ok: false,
              error: reason,
            });
            return { branchId: branch.id, ok: false, error: reason };
          }

          // flat-extractor 와 동일한 pathId 규칙: {parallelPathId}.branches.{idx}.nodes.{idx}
          const subNodePathIds = branch.nodes.map(
            (_, nodeIdx) => `${nodePathId}.branches.${branchIdx}.nodes.${nodeIdx}`,
          );

          // branch 내 nodes 는 순차 실행
          let lastData: unknown = null;
          for (const subPathId of subNodePathIds) {
            if (aborted || token.isCancelled) break;

            const output = await runSubNode(subPathId);

            if (output.status !== 'success') {
              eventBus.emit({
                type: 'flow.branch.complete',
                timestamp: new Date(),
                runId,
                parallelId: nodePathId,
                branchId: branch.id,
                ok: false,
                error: output.error?.message,
              });

              if (!continueOnFailure) {
                aborted = true;
                // branchId 태깅 — catch 블록에서 중복 emit 방지
                const err = Object.assign(
                  new Error(output.error?.message ?? 'branch failure'),
                  { _branchEmitted: true },
                );
                throw err;
              }

              return {
                branchId: branch.id,
                ok: false,
                error: output.error?.message ?? 'failure',
                data: lastData,
              };
            }

            lastData = output.data;
          }

          eventBus.emit({
            type: 'flow.branch.complete',
            timestamp: new Date(),
            runId,
            parallelId: nodePathId,
            branchId: branch.id,
            ok: true,
          });

          return { branchId: branch.id, ok: true, data: lastData };
        } catch (err) {
          if (!continueOnFailure) aborted = true;
          const errMsg = err instanceof Error ? err.message : String(err);

          // _branchEmitted 태그가 없을 때만 emit (이미 emit 된 경우 중복 방지)
          if (!(err instanceof Error && '_branchEmitted' in err)) {
            eventBus.emit({
              type: 'flow.branch.complete',
              timestamp: new Date(),
              runId,
              parallelId: nodePathId,
              branchId: branch.id,
              ok: false,
              error: errMsg,
            });
          }

          if (!continueOnFailure) throw err;
          return { branchId: branch.id, ok: false, error: errMsg };
        } finally {
          semaphore.release();
        }
      },
    );

    let results: BranchResult[];
    try {
      results = await Promise.all(branchPromises);
    } catch (err) {
      // fail-fast: 최소 1개 branch 가 throw — parallel 전체 실패
      const errMsg = err instanceof Error ? err.message : String(err);

      eventBus.emit({
        type: 'flow.parallel.complete',
        timestamp: new Date(),
        runId,
        parallelId: nodePathId,
        branchCount: branches.length,
        failureCount: 1,
      });

      return {
        status: 'failure',
        data: { status: 'failed', branches: {} },
        error: {
          code: 'branch_failure',
          message: errMsg,
          category: 'persistent',
        },
      };
    }

    const branchResults = Object.fromEntries(
      results.map((r) => [r.branchId, { ok: r.ok, data: r.data, error: r.error }]),
    );
    const branchFailures = results.filter((r) => !r.ok);

    eventBus.emit({
      type: 'flow.parallel.complete',
      timestamp: new Date(),
      runId,
      parallelId: nodePathId,
      branchCount: branches.length,
      failureCount: branchFailures.length,
    });

    const overallStatus = branchFailures.length === 0 ? 'success' : 'failure';

    return {
      status: overallStatus,
      data: {
        status: branchFailures.length === 0 ? 'completed' : 'partial',
        branches: branchResults,
        ...(branchFailures.length > 0 && { branchFailures }),
      },
      ...(branchFailures.length > 0 && {
        error: {
          code: 'branch_failure',
          message: `${branchFailures.length} branch(es) failed`,
          category: 'persistent' as const,
        },
      }),
    };
  },
};
