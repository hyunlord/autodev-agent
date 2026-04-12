export interface TaskDetail {
  id: string;
  prompt: string;
  status: string;
  projectDir: string | null;
  result?: string | object;
  createdAt: string;
  updatedAt: string;
  attempts: any[];
  events: any[];
  planningMode?: string;
  agentId?: string;
  executionMode?: string;
  systemPrompt?: string;
  config?: string | object;
  plan?: string | object;
  maxCycles?: number;
  cycleCount?: number;
}

export interface PipelineEvent {
  type: string;
  status?: string;
  message?: string;
  success?: boolean;
  summary?: string;
  level?: string;
  [key: string]: any;
}

export interface SubTaskNode {
  id: string;
  description: string;
  files: string[];
  agent?: string;
  dependsOn?: string[];
  status?: 'pending' | 'running' | 'done' | 'failed';
}

export interface PlanData {
  summary: string;
  codingPrompt: string;
  estimatedFiles: string[];
  verificationSpec: { steps: Array<{ id: string; type: string; description: string; [key: string]: any }> };
  taskCategory?: string;
  recommendedAgent?: string;
  agentName?: string;
  agentId?: string;
  autoSelected?: boolean;
  subTasks?: SubTaskNode[];
}

export interface LiveUsage {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  agentCosts: Record<string, number>;
}

export interface VerificationResult {
  checkId: string;
  status: string;
  detail: string;
}

export interface CycleInfo {
  current: number;
  max: number;
  steps: string[];
}

export interface ScreenshotData {
  path: string;
  checkId: string;
}

export const STAGES = ['pending', 'planning', 'plan_review', 'coding', 'verifying', 'completed'];

export function getStatusColor(status: string): string {
  switch (status) {
    case 'completed': return 'bg-emerald-500';
    case 'failed': case 'escalated': return 'bg-red-500';
    case 'planning': case 'plan_review': return 'bg-amber-500';
    case 'coding': return 'bg-indigo-500';
    case 'verifying': return 'bg-violet-500';
    default: return 'bg-gray-500';
  }
}

export function getStatusTextColor(status: string): string {
  switch (status) {
    case 'completed': return 'text-emerald-400';
    case 'failed': case 'escalated': return 'text-red-400';
    case 'planning': case 'plan_review': return 'text-amber-400';
    case 'coding': return 'text-indigo-400';
    case 'verifying': return 'text-violet-400';
    default: return 'text-gray-400';
  }
}

export function formatElapsed(start: string, end?: string): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
