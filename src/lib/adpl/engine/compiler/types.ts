import type { NodeSpec } from '@/lib/adpl/types';
import type { AdjacencyGraph } from './adjacency';

export type CompileErrorCode =
  | 'parse_error'
  | 'extract_error'
  | 'unknown_target'
  | 'forward_reference'
  | 'parallel_sibling'
  | 'cycle_detected';

export interface CompileError {
  code: CompileErrorCode;
  message: string;
  pathId?: string;
}

export interface CompiledNode {
  pathId: string;
  userId: string;
  spec: NodeSpec;
  /** pathIds that must complete before this node starts */
  prerequisites: string[];
  /** pathIds that depend on this node's completion */
  dependents: string[];
  depth: number;
}

export interface CompiledContext {
  settings: {
    maxParallel: number;
    totalTimeout: number;
    nodeTimeout: number;
    allowedEnvKeys: string[];
  };
  variables: Record<string, unknown>;
}

export interface ExecutionPlan {
  id: string;
  pipelineName: string;
  nodes: Map<string, CompiledNode>;
  topologicalOrder: string[];
  graph: AdjacencyGraph;
  context: CompiledContext;
  compiledAt: number;
}

export interface CompileSuccess {
  ok: true;
  plan: ExecutionPlan;
  warnings: CompileError[];
}

export interface CompileFailure {
  ok: false;
  errors: CompileError[];
  warnings: CompileError[];
}

export type CompileResult = CompileSuccess | CompileFailure;
