import type { AgentInput, VerifyInput } from '@/agents/interfaces';
import type { AgentNodeSpec } from '@/lib/adpl/types/nodes/agent';
import type { ExecutionContext } from '../types';
import type { PipelineEvent } from '@/lib/types';
import type { NodeOutput } from '@/lib/adpl/types';

const DEFAULT_TIMEOUTS: Record<string, number> = {
  planner: 120_000,
  coder: 300_000,
};

function resolveExpressions(prompt: string, ctx: ExecutionContext): string {
  let resolved = prompt;

  if (ctx.$prev?.data !== undefined) {
    resolved = resolved.replace(/\$prev\.data/g, String(ctx.$prev.data));
  }

  for (const [userId, nodeOutput] of Object.entries(ctx.$nodes)) {
    const nodeData = (nodeOutput as NodeOutput).data;
    if (nodeData !== undefined) {
      resolved = resolved.replace(
        new RegExp(`\\$nodes\\.${userId}\\.data`, 'g'),
        String(nodeData),
      );
    }
  }

  return resolved;
}

function collectPreviousResults(ctx: ExecutionContext): unknown {
  const results: Record<string, unknown> = {};
  for (const [userId, nodeOutput] of Object.entries(ctx.$nodes)) {
    results[userId] = (nodeOutput as NodeOutput).data;
  }
  if (ctx.$prev?.data !== undefined) {
    results['$prev'] = ctx.$prev.data;
  }
  return results;
}

export function transformInput(
  spec: AgentNodeSpec,
  ctx: ExecutionContext,
  onProgress: (e: PipelineEvent) => void,
): AgentInput {
  const rawPrompt = spec.prompt ?? ctx.$task?.prompt ?? '';
  const prompt = resolveExpressions(rawPrompt, ctx);

  const role = spec.role ?? 'planner';
  const timeoutMs = spec.timeout
    ? spec.timeout * 1000
    : (DEFAULT_TIMEOUTS[role] ?? 120_000);

  const context: AgentInput['context'] = {
    projectDir: ctx.worktreeRoot,
  };

  if (spec.useMemory) {
    context.previousResults = collectPreviousResults(ctx);
  }

  return {
    prompt,
    context,
    config: {
      systemPrompt: spec.systemPrompt,
      timeoutMs,
    },
    onProgress,
  };
}

export function buildVerifierInput(
  spec: AgentNodeSpec,
  ctx: ExecutionContext,
  onProgress: (e: PipelineEvent) => void,
): VerifyInput {
  const base = transformInput(spec, ctx, onProgress);

  const codeNode = ctx.$nodes['code'] as NodeOutput | undefined;
  const codeData = codeNode?.data as
    | { modifiedFiles?: string[]; text?: string; [key: string]: unknown }
    | undefined;

  const planNode = ctx.$nodes['plan'] as NodeOutput | undefined;
  const planData = planNode?.data as VerifyInput['plan'];

  return {
    ...base,
    originalPrompt: ctx.$task?.prompt ?? '',
    modifiedFiles: codeData?.modifiedFiles ?? [],
    projectDir: ctx.worktreeRoot,
    tools: [],
    plan: planData,
  };
}
