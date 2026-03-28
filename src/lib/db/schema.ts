import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
  id:          text('id').primaryKey(),
  prompt:      text('prompt').notNull(),
  status:      text('status', {
    enum: ['pending', 'planning', 'coding', 'verifying', 'retrying', 'completed', 'failed', 'escalated'],
  }).notNull().default('pending'),
  planningMode: text('planning_mode', {
    enum: ['auto', 'manual', 'api'],
  }).notNull().default('auto'),
  projectDir:  text('project_dir'),
  projectType: text('project_type'),
  config:      text('config', { mode: 'json' }),
  result:      text('result', { mode: 'json' }),
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
