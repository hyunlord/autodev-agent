/**
 * A2-2 타입 추론 정합 검증 — pnpm tsc --noEmit 으로 검증.
 * z.infer<typeof Schema> === A2-1 TypeScript interface 컴파일 타임 확인.
 */

import type { z } from 'zod';
import type {
  AdplPipeline,
  PipelineSettings,
  NodeSpec,
  AgentNodeSpec,
  ShellNodeSpec,
  HttpNodeSpec,
  WebhookOutNodeSpec,
  BranchNodeSpec,
  CaseSpec,
  ParallelNodeSpec,
  ParallelBranchSpec,
  LoopNodeSpec,
  GateNodeSpec,
  McpNodeSpec,
  SetNodeSpec,
  TransformNodeSpec,
  TransformParams,
  TriggerSpec,
  RetryPolicy,
} from '../../types/index';
import type {
  TaskCreatedTrigger,
  ManualTrigger,
  ScheduleTrigger,
  WebhookInTrigger,
  GitEventTrigger,
} from '../../types/triggers/index';
import type {
  AdplPipelineSchema,
  PipelineSettingsSchema,
  NodeSpecSchema,
  AgentNodeSpecSchema,
  ShellNodeSpecSchema,
  HttpNodeSpecSchema,
  WebhookOutNodeSpecSchema,
  BranchNodeSpecSchema,
  CaseSpecSchema,
  ParallelNodeSpecSchema,
  ParallelBranchSpecSchema,
  LoopNodeSpecSchema,
  GateNodeSpecSchema,
  McpNodeSpecSchema,
  SetNodeSpecSchema,
  TransformNodeSpecSchema,
  TransformParamsSchema,
  TriggerSpecSchema,
  RetryPolicySchema,
  TaskCreatedTriggerSchema,
  ManualTriggerSchema,
  ScheduleTriggerSchema,
  WebhookInTriggerSchema,
  GitEventTriggerSchema,
} from '../index';

// 컴파일 타임 Equal 유틸리티
type Expect<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false;

// ① 최상위 파이프라인
type _AdplPipeline = Expect<Equal<z.infer<typeof AdplPipelineSchema>, AdplPipeline>>;
type _PipelineSettings = Expect<Equal<z.infer<typeof PipelineSettingsSchema>, PipelineSettings>>;

// ② 공통
type _RetryPolicy = Expect<Equal<z.infer<typeof RetryPolicySchema>, RetryPolicy>>;

// ③ 노드 유니온
type _NodeSpec = Expect<Equal<z.infer<typeof NodeSpecSchema>, NodeSpec>>;

// ④ 12 노드 타입
type _AgentNodeSpec = Expect<Equal<z.infer<typeof AgentNodeSpecSchema>, AgentNodeSpec>>;
type _ShellNodeSpec = Expect<Equal<z.infer<typeof ShellNodeSpecSchema>, ShellNodeSpec>>;
type _HttpNodeSpec = Expect<Equal<z.infer<typeof HttpNodeSpecSchema>, HttpNodeSpec>>;
type _WebhookOutNodeSpec = Expect<
  Equal<z.infer<typeof WebhookOutNodeSpecSchema>, WebhookOutNodeSpec>
>;
type _BranchNodeSpec = Expect<Equal<z.infer<typeof BranchNodeSpecSchema>, BranchNodeSpec>>;
type _CaseSpec = Expect<Equal<z.infer<typeof CaseSpecSchema>, CaseSpec>>;
type _ParallelNodeSpec = Expect<Equal<z.infer<typeof ParallelNodeSpecSchema>, ParallelNodeSpec>>;
type _ParallelBranchSpec = Expect<
  Equal<z.infer<typeof ParallelBranchSpecSchema>, ParallelBranchSpec>
>;
type _LoopNodeSpec = Expect<Equal<z.infer<typeof LoopNodeSpecSchema>, LoopNodeSpec>>;
type _GateNodeSpec = Expect<Equal<z.infer<typeof GateNodeSpecSchema>, GateNodeSpec>>;
type _McpNodeSpec = Expect<Equal<z.infer<typeof McpNodeSpecSchema>, McpNodeSpec>>;
type _SetNodeSpec = Expect<Equal<z.infer<typeof SetNodeSpecSchema>, SetNodeSpec>>;
type _TransformNodeSpec = Expect<Equal<z.infer<typeof TransformNodeSpecSchema>, TransformNodeSpec>>;
type _TransformParams = Expect<Equal<z.infer<typeof TransformParamsSchema>, TransformParams>>;

// ⑤ 5 트리거 타입
type _TriggerSpec = Expect<Equal<z.infer<typeof TriggerSpecSchema>, TriggerSpec>>;
type _TaskCreatedTrigger = Expect<
  Equal<z.infer<typeof TaskCreatedTriggerSchema>, TaskCreatedTrigger>
>;
type _ManualTrigger = Expect<Equal<z.infer<typeof ManualTriggerSchema>, ManualTrigger>>;
type _ScheduleTrigger = Expect<Equal<z.infer<typeof ScheduleTriggerSchema>, ScheduleTrigger>>;
type _WebhookInTrigger = Expect<Equal<z.infer<typeof WebhookInTriggerSchema>, WebhookInTrigger>>;
type _GitEventTrigger = Expect<Equal<z.infer<typeof GitEventTriggerSchema>, GitEventTrigger>>;

// 런타임 실행 없음 — 타입 체크만 통과하면 OK
export {};
