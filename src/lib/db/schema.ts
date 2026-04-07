import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
  id:          text('id').primaryKey(),
  prompt:      text('prompt').notNull(),
  status:      text('status', {
    enum: ['pending', 'planning', 'plan_review', 'coding', 'verifying', 'retrying', 'completed', 'failed', 'escalated', 'interview'],
  }).notNull().default('pending'),
  planningMode: text('planning_mode', {
    enum: ['auto', 'claude-cli', 'gemini-cli', 'codex-cli', 'api', 'manual'],
  }).notNull().default('claude-cli'),
  agentId:     text('agent_id').notNull().default('claude-code'),
  projectDir:  text('project_dir'),
  projectType: text('project_type'),
  plan:        text('plan', { mode: 'json' }),
  systemPrompt: text('system_prompt'),
  planningSystemPrompt: text('planning_system_prompt'),
  codingSystemPrompt:   text('coding_system_prompt'),
  executionMode: text('execution_mode', {
    enum: ['single', 'auto-cycle', 'interview'],
  }).notNull().default('single'),
  cycleCount:  integer('cycle_count').notNull().default(0),
  maxCycles:   integer('max_cycles').notNull().default(10),
  config:      text('config', { mode: 'json' }),
  result:      text('result', { mode: 'json' }),
  parentTaskId: text('parent_task_id'),
  createdAt:   text('created_at').notNull(),
  updatedAt:   text('updated_at').notNull(),
});

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
  createdAt:   text('created_at').notNull(),
});

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
});
