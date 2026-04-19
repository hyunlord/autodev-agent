import { z } from 'zod';
import { NodeSpecBaseSchema } from '../common';
import type { ParallelBranchSpec } from '../../types/nodes/parallel';
import type { NodeSpec } from '../../types/nodes/index';
// NodeSpecSchema는 z.lazy 내부에서만 접근 — ESM live binding으로 순환 의존 해결
import { NodeSpecSchema } from './index';

export const MergeStrategySchema = z.enum([
  'all_must_pass',
  'any_succeeds',
  'majority',
  'best_score',
] as const);

// z.ZodType<ParallelBranchSpec> 어노테이션 유지 — ParallelNodeSpec.branches 타입 추론에 필요
export const ParallelBranchSpecSchema: z.ZodType<ParallelBranchSpec> = z.object({
  id: z.string(),
  nodes: z.lazy((): z.ZodType<NodeSpec[]> => z.array(NodeSpecSchema)),
});

export const ParallelNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('parallel'),
  branches: z.array(ParallelBranchSpecSchema),
  mergeStrategy: MergeStrategySchema.optional(),
  maxConcurrent: z.number().int().positive().optional(),
  onError: z.enum(['abort_all', 'continue']).optional(),
  cancelOnFirstFailure: z.boolean().optional(),
});
