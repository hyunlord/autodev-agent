import { z } from 'zod';
import { NodeSpecBaseSchema } from '../common';
import { ConditionSchema } from '../expression';
import type { CaseSpec } from '../../types/nodes/branch';
import type { NodeSpec } from '../../types/nodes/index';
// NodeSpecSchema는 z.lazy 내부에서만 접근 — ESM live binding으로 순환 의존 해결
import { NodeSpecSchema } from './index';

// z.ZodType<CaseSpec> 어노테이션 유지 — BranchNodeSpec.cases 타입 추론에 필요
export const CaseSpecSchema: z.ZodType<CaseSpec> = z.object({
  when: ConditionSchema.optional(),
  default: z.boolean().optional(),
  then: z.lazy((): z.ZodType<NodeSpec[]> => z.array(NodeSpecSchema)),
});

export const BranchNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('branch'),
  cases: z.array(CaseSpecSchema),
  evaluationMode: z.enum(['first_match', 'all_match']).optional(),
  onMissingMatch: z.enum(['skip', 'error']).optional(),
});
