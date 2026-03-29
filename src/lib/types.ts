export type TaskStatus = 'pending' | 'planning' | 'coding' | 'verifying' | 'retrying' | 'completed' | 'failed' | 'escalated';

export type PlanningMode = 'auto' | 'manual' | 'api';

export type PipelineEvent =
  | { type: 'status_change'; status: TaskStatus; message: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; timestamp?: string }
  | { type: 'screenshot'; path: string; checkId: string }
  | { type: 'verification_result'; checkId: string; status: 'pass' | 'fail' | 'skip'; detail: string }
  | { type: 'attempt_start'; attemptNum: number; agentId: string }
  | { type: 'attempt_complete'; attemptNum: number; success: boolean; error?: string }
  | { type: 'task_complete'; success: boolean; summary: string }
  | { type: 'escalation'; report: string };
