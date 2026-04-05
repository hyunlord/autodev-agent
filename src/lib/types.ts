export type TaskStatus = 'pending' | 'planning' | 'plan_review' | 'coding' | 'verifying' | 'retrying' | 'completed' | 'failed' | 'escalated' | 'interview';

export type PlanningMode = 'claude-cli' | 'gemini-cli' | 'codex-cli' | 'api' | 'manual' | 'debate';

export type ExecutionMode = 'single' | 'auto-cycle' | 'interview';

export type PipelineEvent =
  | { type: 'status_change'; status: TaskStatus; message: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; timestamp?: string }
  | { type: 'screenshot'; path: string; checkId: string }
  | { type: 'verification_result'; checkId: string; status: 'pass' | 'fail' | 'skip'; detail: string }
  | { type: 'attempt_start'; attemptNum: number; agentId: string }
  | { type: 'attempt_complete'; attemptNum: number; success: boolean; error?: string }
  | { type: 'task_complete'; success: boolean; summary: string }
  | { type: 'escalation'; report: string }
  | { type: 'plan_ready'; plan: { summary: string; codingPrompt: string; estimatedFiles: string[]; verificationSpec: any; taskCategory?: string; recommendedAgent?: string; agentName?: string; agentId?: string; autoSelected?: boolean } }
  | { type: 'cycle_start'; cycleNum: number; totalCycles: number; message: string }
  | { type: 'cycle_complete'; cycleNum: number; success: boolean; summary: string }
  | { type: 'auto_cycle_complete'; totalCycles: number; summary: string }
  | { type: 'cost_update'; attemptNum: number; costUsd: number; totalCostUsd: number; inputTokens: number; outputTokens: number; agentId: string }
  | { type: 'interview_questions'; questions: string[]; message: string };
