import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
  id:          text('id').primaryKey(),
  prompt:      text('prompt').notNull(),
  status:      text('status', {
    enum: ['pending', 'planning', 'plan_review', 'coding', 'verifying', 'retrying', 'completed', 'failed', 'escalated', 'interview'],
  }).notNull().default('pending'),
  planningMode: text('planning_mode', {
    enum: ['auto', 'claude-cli', 'gemini-cli', 'codex-cli', 'api', 'manual', 'debate'],
  }).notNull().default('claude-cli'),
  agentId:     text('agent_id').notNull().default('claude-code'),
  projectDir:  text('project_dir'),
  projectType: text('project_type'),
  plan:        text('plan', { mode: 'json' }),
  systemPrompt: text('system_prompt'),
  planningSystemPrompt: text('planning_system_prompt'),
  codingSystemPrompt:   text('coding_system_prompt'),
  executionMode: text('execution_mode', {
    enum: ['single', 'auto-cycle', 'interview', 'arena'],
  }).notNull().default('single'),
  cycleCount:  integer('cycle_count').notNull().default(0),
  maxCycles:   integer('max_cycles').notNull().default(10),
  config:      text('config', { mode: 'json' }),
  result:      text('result', { mode: 'json' }),
  parentTaskId: text('parent_task_id'),
  pipelineMode: text('pipeline_mode').notNull().default('legacy'),
  pipelineVersionId: text('pipeline_version_id').references(() => pipelineVersions.id),
  projectId:   text('project_id').references(() => projects.id),
  createdAt:   text('created_at').notNull(),
  updatedAt:   text('updated_at').notNull(),
}, (table) => [
  index('idx_tasks_status').on(table.status),
  index('idx_tasks_created_at').on(table.createdAt),
  index('idx_tasks_project_dir').on(table.projectDir),
]);

export const attempts = sqliteTable('attempts', {
  id:          text('id').primaryKey(),
  taskId:      text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  attemptNum:  integer('attempt_num').notNull(),
  agentId:     text('agent_id').notNull(),
  phase:       text('phase', { enum: ['planning', 'coding', 'verifying'] }).notNull(),
  status:      text('status', { enum: ['running', 'success', 'error'] }).notNull(),
  input:       text('input', { mode: 'json' }),
  output:      text('output', { mode: 'json' }),
  errorLog:    text('error_log'),
  errorHash:   text('error_hash'),
  costUsd:     real('cost_usd'),
  tokenCount:  integer('token_count'),
  durationMs:  integer('duration_ms'),
  promptVersions: text('prompt_versions'),  // JSON: { planner: "a3b2c1d4", coder: "e5f6g7h8", ... }
  createdAt:   text('created_at').notNull(),
}, (table) => [
  index('idx_attempts_task_id').on(table.taskId),
]);

export const verifications = sqliteTable('verifications', {
  id:             text('id').primaryKey(),
  attemptId:      text('attempt_id').notNull().references(() => attempts.id, { onDelete: 'cascade' }),
  checkId:        text('check_id').notNull(),
  type:           text('type').notNull(),
  status:         text('status', { enum: ['pass', 'fail', 'skip'] }).notNull(),
  expected:       text('expected'),
  actual:         text('actual'),
  screenshotPath: text('screenshot_path'),
  vlmFeedback:    text('vlm_feedback'),
  vlmConfidence:  real('vlm_confidence'),
  durationMs:     integer('duration_ms'),
  createdAt:      text('created_at').notNull(),
});

export const events = sqliteTable('events', {
  id:        text('id').primaryKey(),
  taskId:    text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  type:      text('type').notNull(),
  data:      text('data', { mode: 'json' }),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_events_task_id').on(table.taskId),
  index('idx_events_created_at').on(table.createdAt),
]);

export const webhooks = sqliteTable('webhooks', {
  id:              text('id').primaryKey(),
  name:            text('name').notNull(),
  url:             text('url').notNull(),
  platform:        text('platform', { enum: ['slack', 'discord'] }).notNull(),
  events:          text('events', { mode: 'json' }).$type<Array<'completed' | 'failed' | 'low_score'>>().notNull(),
  enabled:         integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastTriggeredAt: text('last_triggered_at'),
  lastError:       text('last_error'),
  createdAt:       text('created_at').notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase P — ADPL (Adaptive Declarative Pipeline Language) tables
// 도입: Stage 1 A1-2 (2026-04-19). 기존 legacy 테이블과 분리.
// 타임스탬프는 ISO 8601 text, FK 는 기존 컨벤션(onDelete: 'cascade') 일치.
// 사용처: Phase P 엔진 (Stage 2+). legacy task flow 에는 영향 없음.
// ─────────────────────────────────────────────────────────────────────────────

export const projects = sqliteTable('projects', {
  id:          text('id').primaryKey(),
  name:        text('name').notNull(),
  path:        text('path').notNull(),
  description: text('description'),
  icon:        text('icon'),
  createdAt:   text('created_at').notNull(),
  updatedAt:   text('updated_at').notNull(),
}, (table) => [
  index('projects_path_idx').on(table.path),
  index('projects_name_idx').on(table.name),
]);

export const pipelineVersions = sqliteTable('pipeline_versions', {
  id:          text('id').primaryKey(),
  projectId:   text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),

  pipelineYaml: text('pipeline_yaml').notNull(),
  adplVersion:  text('adpl_version').notNull().default('1.0'),

  modelPreset:   text('model_preset'),
  harnessPreset: text('harness_preset'),
  planningModel: text('planning_model'),
  codingModel:   text('coding_model'),
  verifyModel:   text('verify_model'),

  changeSource: text('change_source', {
    enum: ['manual', 'ai_edit', 'evolve', 'wizard', 'preset', 'rollback'],
  }).notNull(),
  changeDescription: text('change_description'),
  changedBy:         text('changed_by'),

  createdAt: text('created_at').notNull(),
}, (table) => [
  index('pipeline_versions_project_idx').on(table.projectId),
  uniqueIndex('pipeline_versions_project_version_unique').on(table.projectId, table.versionNumber),
]);

export const worktrees = sqliteTable('worktrees', {
  id:        text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),

  name:      text('name').notNull(),
  path:      text('path').notNull(),
  gitBranch: text('git_branch'),

  isMain:     integer('is_main', { mode: 'boolean' }).notNull().default(false),
  status:     text('status', { enum: ['active', 'busy', 'archived', 'deleted'] }).notNull().default('active'),
  portOffset: integer('port_offset').notNull().default(0),

  sessionMode:      text('session_mode', { enum: ['single', 'multi', 'ephemeral'] }).default('single'),
  autoCleanup:      integer('auto_cleanup', { mode: 'boolean' }).default(false),
  cleanupAfterDays: integer('cleanup_after_days'),

  createdAt:  text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
}, (table) => [
  index('worktrees_project_idx').on(table.projectId),
  index('worktrees_status_idx').on(table.status),
  uniqueIndex('worktrees_project_name_unique').on(table.projectId, table.name),
]);

export const worktreeSessions = sqliteTable('worktree_sessions', {
  id:         text('id').primaryKey(),
  worktreeId: text('worktree_id').notNull().references(() => worktrees.id, { onDelete: 'cascade' }),

  status: text('status', { enum: ['active', 'idle', 'closed'] }).notNull().default('active'),

  // FK 는 순환 방지 위해 걸지 않음 (tasks 는 legacy, worktree_sessions 는 phase-p)
  currentTaskId: text('current_task_id'),
  tasksExecuted: integer('tasks_executed').default(0),

  startedAt:      text('started_at').notNull(),
  lastActivityAt: text('last_activity_at'),
  closedAt:       text('closed_at'),
}, (table) => [
  index('worktree_sessions_worktree_idx').on(table.worktreeId),
  index('worktree_sessions_status_idx').on(table.status),
]);

export const pipelineRuns = sqliteTable('pipeline_runs', {
  id:                text('id').primaryKey(),
  // taskId FK 는 A1-3 에서 tasks 확장 후 추가 (새 migration)
  taskId:            text('task_id').notNull(),
  pipelineVersionId: text('pipeline_version_id').notNull().references(() => pipelineVersions.id),
  projectId:         text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),

  status: text('status', {
    enum: ['initializing', 'running', 'completed', 'failed', 'cancelled', 'resumed'],
  }).notNull(),

  startedAt:         text('started_at').notNull(),
  completedAt:       text('completed_at'),
  lastCheckpointAt:  text('last_checkpoint_at'),

  nodesCompleted: integer('nodes_completed').default(0),
  nodesFailed:    integer('nodes_failed').default(0),
  totalCostUsd:   real('total_cost_usd').default(0),
  totalTokensIn:  integer('total_tokens_in').default(0),
  totalTokensOut: integer('total_tokens_out').default(0),

  triggerContext: text('trigger_context', { mode: 'json' }),

  error:         text('error', { mode: 'json' }),
  failedNodeId:  text('failed_node_id'),

  resumedFromRunId: text('resumed_from_run_id'),
  lastResumedAt:    text('last_resumed_at'),
  resumeCount:      integer('resume_count').default(0),
}, (table) => [
  index('pipeline_runs_task_idx').on(table.taskId),
  index('pipeline_runs_status_idx').on(table.status),
  index('pipeline_runs_project_idx').on(table.projectId),
  index('pipeline_runs_version_idx').on(table.pipelineVersionId),
]);

export const nodeRuns = sqliteTable('node_runs', {
  id:             text('id').primaryKey(),
  pipelineRunId:  text('pipeline_run_id').notNull().references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  nodeId:         text('node_id').notNull(),

  attemptNumber: integer('attempt_number').notNull(),
  // status 는 ADPL 스펙의 8 상태: pending/ready/running/success/failure/cancelled/skipped/waiting.
  // enum 고정은 스펙 확정 후 A1-4 에서 반영. 현재는 text 로 유연.
  status:        text('status').notNull(),

  startedAt:   text('started_at'),
  completedAt: text('completed_at'),
  durationMs:  integer('duration_ms'),

  output: text('output', { mode: 'json' }),
  error:  text('error', { mode: 'json' }),

  parentFlowNodeId: text('parent_flow_node_id'),
  iterationIndex:   integer('iteration_index'),
  branchId:         text('branch_id'),

  costUsd:   real('cost_usd').default(0),
  tokensIn:  integer('tokens_in').default(0),
  tokensOut: integer('tokens_out').default(0),
}, (table) => [
  index('node_runs_run_node_idx').on(table.pipelineRunId, table.nodeId),
  index('node_runs_status_idx').on(table.status),
]);

export const triggerRoutes = sqliteTable('trigger_routes', {
  id:                text('id').primaryKey(),
  projectId:         text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  pipelineVersionId: text('pipeline_version_id').notNull().references(() => pipelineVersions.id, { onDelete: 'cascade' }),

  triggerId:   text('trigger_id').notNull(),
  triggerType: text('trigger_type', {
    enum: ['task_created', 'manual', 'schedule', 'webhook_in', 'git_event'],
  }).notNull(),

  config:  text('config', { mode: 'json' }).notNull(),

  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),

  lastTriggeredAt: text('last_triggered_at'),
  triggerCount:    integer('trigger_count').default(0),

  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('trigger_routes_project_idx').on(table.projectId),
  index('trigger_routes_type_idx').on(table.triggerType),
  index('trigger_routes_enabled_idx').on(table.enabled),
  index('trigger_routes_version_idx').on(table.pipelineVersionId),
]);

export const shadowRuns = sqliteTable('shadow_runs', {
  id:               text('id').primaryKey(),
  taskId:           text('task_id').notNull(),
  projectId:        text('project_id').notNull(),
  legacyOk:         integer('legacy_ok', { mode: 'boolean' }).notNull(),
  legacyDurationMs: integer('legacy_duration_ms').notNull(),
  legacyError:      text('legacy_error'),
  shadowOk:         integer('shadow_ok', { mode: 'boolean' }).notNull(),
  shadowDurationMs: integer('shadow_duration_ms').notNull(),
  shadowError:      text('shadow_error'),
  shadowStatus:     text('shadow_status'),
  createdAt:        text('created_at').notNull(),
}, (table) => [
  index('shadow_runs_task_idx').on(table.taskId),
  index('shadow_runs_project_idx').on(table.projectId),
]);
