import { z } from 'zod';
import type { NodeSpec } from '../../types/nodes/index';
import { AgentNodeSpecSchema } from './agent';
import { ShellNodeSpecSchema } from './shell';
import { HttpNodeSpecSchema } from './http';
import { WebhookOutNodeSpecSchema } from './webhook-out';
import { BranchNodeSpecSchema } from './branch';
import { ParallelNodeSpecSchema } from './parallel';
import { LoopNodeSpecSchema } from './loop';
import { GateNodeSpecSchema } from './gate';
import { McpNodeSpecSchema } from './mcp';
import { SetNodeSpecSchema } from './set';
import { TransformNodeSpecSchema } from './transform';

// z.lazy로 순환 의존 해결 (branch/parallel/loop가 NodeSpecSchema를 참조)
export const NodeSpecSchema: z.ZodType<NodeSpec> = z.lazy(() =>
  z.discriminatedUnion('type', [
    AgentNodeSpecSchema,
    ShellNodeSpecSchema,
    HttpNodeSpecSchema,
    WebhookOutNodeSpecSchema,
    BranchNodeSpecSchema,
    ParallelNodeSpecSchema,
    LoopNodeSpecSchema,
    GateNodeSpecSchema,
    McpNodeSpecSchema,
    SetNodeSpecSchema,
    TransformNodeSpecSchema,
  ])
);

export {
  AgentNodeSpecSchema,
  AgentRoleSchema,
  OutputSpecSchema,
  FallbackSpecSchema,
  ToolPolicySpecSchema,
} from './agent';
export { ShellNodeSpecSchema, ShellOutputFormatSchema, ShellModeSchema } from './shell';
export { HttpNodeSpecSchema, HttpMethodSchema, BodyFormatSchema, HttpRetryPolicySchema } from './http';
export { WebhookOutNodeSpecSchema, WebhookOutProviderSchema } from './webhook-out';
export { BranchNodeSpecSchema, CaseSpecSchema } from './branch';
export { ParallelNodeSpecSchema, ParallelBranchSpecSchema, MergeStrategySchema } from './parallel';
export { LoopNodeSpecSchema, LoopModeSchema } from './loop';
export { GateNodeSpecSchema, NotifyConfigSchema } from './gate';
export { McpNodeSpecSchema, McpSessionModeSchema } from './mcp';
export { SetNodeSpecSchema } from './set';
export {
  TransformNodeSpecSchema,
  TransformOperationSchema,
  TransformParamsSchema,
  FilterParamsSchema,
  MapParamsSchema,
  PluckParamsSchema,
} from './transform';
