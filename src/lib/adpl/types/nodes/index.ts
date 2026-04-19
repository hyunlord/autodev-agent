import type { AgentNodeSpec } from './agent';
import type { ShellNodeSpec } from './shell';
import type { HttpNodeSpec } from './http';
import type { WebhookOutNodeSpec } from './webhook-out';
import type { BranchNodeSpec } from './branch';
import type { ParallelNodeSpec } from './parallel';
import type { LoopNodeSpec } from './loop';
import type { GateNodeSpec } from './gate';
import type { McpNodeSpec } from './mcp';
import type { SetNodeSpec } from './set';
import type { TransformNodeSpec } from './transform';

export type NodeSpec =
  | AgentNodeSpec
  | ShellNodeSpec
  | HttpNodeSpec
  | WebhookOutNodeSpec
  | BranchNodeSpec
  | ParallelNodeSpec
  | LoopNodeSpec
  | GateNodeSpec
  | McpNodeSpec
  | SetNodeSpec
  | TransformNodeSpec;

export type { AgentNodeSpec, AgentRole, OutputSpec, FallbackSpec, ToolPolicySpec } from './agent';
export type { ShellNodeSpec, ShellOutputFormat, ShellMode } from './shell';
export type { HttpNodeSpec, HttpMethod, BodyFormat, HttpRetryPolicy } from './http';
export type { WebhookOutNodeSpec, WebhookOutProvider } from './webhook-out';
export type { BranchNodeSpec, CaseSpec } from './branch';
export type { ParallelNodeSpec, ParallelBranchSpec, MergeStrategy } from './parallel';
export type { LoopNodeSpec, LoopMode } from './loop';
export type { GateNodeSpec, NotifyConfig } from './gate';
export type { McpNodeSpec, McpSessionMode } from './mcp';
export type { SetNodeSpec } from './set';
export type { TransformNodeSpec, TransformOperation, TransformParams, FilterParams, MapParams, PluckParams } from './transform';
