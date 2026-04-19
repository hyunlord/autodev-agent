import type { ISOTimestamp, NodeId } from './common';
import type { NodeOutputAccessor } from './output';

export interface TaskContext {
  id: string;
  prompt: string;
  tags: string[];
  createdAt: ISOTimestamp;
  pipelineMode: 'pipeline' | 'legacy';
  projectId: string | null;
  pipelineVersionId: string | null;
  status: string;
  config: Record<string, unknown>;
}

export interface ProjectContext {
  id: string;
  name: string;
  path: string;
  description: string | null;
  createdAt: ISOTimestamp;
}

// §3.4 $loop — loop 노드 내부에서만 접근 가능
export interface LoopContext {
  index: number;
  total: number; // forEach/times 에서만 확정
  isFirst: boolean;
  isLast: boolean;
  [as: string]: unknown; // $loop.<as> 동적 필드
}

// §3.5 $flow — branch/parallel/gate 내부 컨텍스트
export interface BranchFlowContext {
  matchedBranch: string; // 선택된 case 인덱스 또는 id
}

export interface ParallelFlowContext {
  parallelIndex: number;
  parallelTotal: number;
}

export interface GateFlowContext {
  gateStatus: 'pending' | 'approved' | 'rejected';
  gateRespondedBy: string | null;
}

export type FlowContext = BranchFlowContext | ParallelFlowContext | GateFlowContext;

// §3.7 $trigger — 파이프라인 실행 트리거 정보
export interface TriggerContextBase {
  triggerId: string;
  type: string;
  firedAt: ISOTimestamp;
}

export interface WebhookTriggerContext extends TriggerContextBase {
  type: 'webhook_in';
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  sourceIp: string;
}

export interface ScheduleTriggerContext extends TriggerContextBase {
  type: 'schedule';
  scheduledAt: ISOTimestamp;
}

export interface GitEventTriggerContext extends TriggerContextBase {
  type: 'git_event';
  event: GitEventPayload;
}

export interface GitEventPayload {
  type: string;
  number?: number;
  title?: string;
  author: string;
  headBranch: string;
  baseBranch: string;
  headSha: string;
  repository: {
    owner: string;
    name: string;
    fullName: string;
  };
  labels: string[];
  changedPaths?: string[];
}

export type TriggerContext =
  | TriggerContextBase
  | WebhookTriggerContext
  | ScheduleTriggerContext
  | GitEventTriggerContext;

// 각 노드 실행 시 주입되는 런타임 컨텍스트
export interface NodeExecutionContext {
  task: TaskContext;
  project: ProjectContext | null; // $task.projectId == null 이면 null
  nodes: Record<NodeId, NodeOutputAccessor>;
  loop?: LoopContext; // loop 노드 내부만
  flow?: FlowContext; // flow 노드 내부만
  env: Record<string, string>; // settings.allowedEnvKeys 허용 목록
  trigger: TriggerContext;
}
