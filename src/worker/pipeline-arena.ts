import { PluginRegistry } from '../lib/plugins/registry';
import type { ICodingAgent } from '../lib/plugins/interfaces';
import type { EmitFn } from './pipeline-types';
import type { Plan } from './planning';
import type { PipelineEvent } from '../lib/types';

export interface ArenaResult {
  agentId: string;
  success: boolean;
  modifiedFiles: string[];
  costUsd: number;
  durationMs: number;
  verifyScore: number;
}

export interface ArenaOutcome {
  winner: ArenaResult;
  allResults: ArenaResult[];
  totalCost: number;
}

/**
 * Arena Mode — 여러 에이전트가 같은 작업을 경쟁.
 *
 * 흐름:
 * 1. available 에이전트 중 최대 3개 선택
 * 2. 각각 독립적으로 Coding 실행 (git worktree로 격리)
 * 3. 각 결과에 대해 Verify 실행 (향후)
 * 4. 최고 점수의 결과를 선택
 * 5. 선택된 결과의 코드를 main에 머지
 */
export async function executeArena(params: {
  plan: Plan;
  projectDir: string;
  systemPrompt: string | null;
  workspaceContext: string;
  emit: EmitFn;
  maxContenders?: number;
  signal?: AbortSignal;
}): Promise<ArenaOutcome | null> {
  const { plan, projectDir, emit, maxContenders = 3, signal } = params;

  // 1. 참가 에이전트 선택
  const allAgents = PluginRegistry.instance.listAgents();
  const availableChecks = await Promise.all(
    allAgents.map(async (a) => ({ agent: a, available: await a.isAvailable() })),
  );
  const available = availableChecks.filter(a => a.available).map(a => a.agent);

  if (available.length < 2) {
    emit({ type: 'log', level: 'warn',
      message: '[Arena] Need at least 2 agents. Falling back to normal mode.' } as PipelineEvent);
    return null;
  }

  const contenders = available.slice(0, maxContenders);
  emit({ type: 'log', level: 'info',
    message: `[Arena] Starting with ${contenders.length} contenders: ${contenders.map(a => a.id).join(', ')}` } as PipelineEvent);

  // 2. 병렬 실행
  const results = await Promise.allSettled(
    contenders.map(agent => executeContender({
      agent,
      plan,
      projectDir,
      systemPrompt: params.systemPrompt,
      workspaceContext: params.workspaceContext,
      emit,
      signal,
    })),
  );

  // 3. 결과 수집
  const successResults: ArenaResult[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled' && result.value) {
      successResults.push(result.value);
      emit({ type: 'log', level: 'info',
        message: `[Arena] ${contenders[i].id}: success=${result.value.success}, cost=$${result.value.costUsd.toFixed(4)}` } as PipelineEvent);
    } else {
      const reason = result.status === 'rejected' ? result.reason : 'no result';
      emit({ type: 'log', level: 'warn',
        message: `[Arena] ${contenders[i].id}: failed — ${reason}` } as PipelineEvent);
    }
  }

  if (successResults.length === 0) {
    emit({ type: 'log', level: 'error', message: '[Arena] All contenders failed' } as PipelineEvent);
    return null;
  }

  // 4. 성공한 에이전트 중 비용 대비 성공 기준으로 선택 (향후 Verify 점수로 대체)
  const winner = successResults.reduce((best, curr) => {
    if (curr.success && !best.success) return curr;
    if (curr.verifyScore > best.verifyScore) return curr;
    return best;
  });

  const totalCost = successResults.reduce((sum, r) => sum + r.costUsd, 0);

  emit({ type: 'log', level: 'info',
    message: `[Arena] Winner: ${winner.agentId} (total arena cost: $${totalCost.toFixed(4)})` } as PipelineEvent);

  return { winner, allResults: successResults, totalCost };
}

async function executeContender(params: {
  agent: ICodingAgent;
  plan: Plan;
  projectDir: string;
  systemPrompt: string | null;
  workspaceContext: string;
  emit: EmitFn;
  signal?: AbortSignal;
}): Promise<ArenaResult> {
  const { agent, plan, projectDir, emit } = params;
  const startTime = Date.now();

  const { getExeca } = await import('../lib/execa');
  const execa = await getExeca();
  const { join } = await import('path');

  const branchName = `arena-${agent.id}-${Date.now()}`;
  const worktreePath = join(projectDir, '.autodev', 'arena', agent.id);

  try {
    // worktree 생성
    const { mkdirSync } = await import('fs');
    mkdirSync(join(projectDir, '.autodev', 'arena'), { recursive: true });
    await execa('git', ['worktree', 'add', '-b', branchName, worktreePath], {
      cwd: projectDir, timeout: 30_000,
    });

    // Coding 실행
    const codingResult = await agent.invoke({
      task: plan.codingPrompt,
      projectDir: worktreePath,
      timeoutMs: 300_000,
      onProgress: (event) => {
        emit({ type: 'log', level: 'info',
          message: `[Arena/${agent.id}] ${(event as any).message ?? ''}` } as PipelineEvent);
      },
    });

    return {
      agentId: agent.id,
      success: codingResult.success,
      modifiedFiles: codingResult.modifiedFiles ?? [],
      costUsd: codingResult.costUsd ?? 0,
      durationMs: Date.now() - startTime,
      verifyScore: codingResult.success ? 50 : 0, // 향후 Verify Agent 점수로 대체
    };
  } catch (err) {
    return {
      agentId: agent.id,
      success: false,
      modifiedFiles: [],
      costUsd: 0,
      durationMs: Date.now() - startTime,
      verifyScore: 0,
    };
  } finally {
    // cleanup — best effort
    try {
      await execa('git', ['worktree', 'remove', worktreePath, '--force'], {
        cwd: projectDir, timeout: 15_000, reject: false,
      });
      await execa('git', ['branch', '-D', branchName], {
        cwd: projectDir, timeout: 5_000, reject: false,
      });
    } catch { /* cleanup best effort */ }
  }
}
