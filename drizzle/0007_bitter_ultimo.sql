PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`planning_mode` text DEFAULT 'claude-cli' NOT NULL,
	`agent_id` text DEFAULT 'claude-code' NOT NULL,
	`project_dir` text,
	`project_type` text,
	`plan` text,
	`system_prompt` text,
	`planning_system_prompt` text,
	`coding_system_prompt` text,
	`execution_mode` text DEFAULT 'single' NOT NULL,
	`cycle_count` integer DEFAULT 0 NOT NULL,
	`max_cycles` integer DEFAULT 10 NOT NULL,
	`config` text,
	`result` text,
	`parent_task_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "prompt", "status", "planning_mode", "agent_id", "project_dir", "project_type", "plan", "system_prompt", "planning_system_prompt", "coding_system_prompt", "execution_mode", "cycle_count", "max_cycles", "config", "result", "parent_task_id", "created_at", "updated_at") SELECT "id", "prompt", "status", "planning_mode", "agent_id", "project_dir", "project_type", "plan", "system_prompt", "planning_system_prompt", "coding_system_prompt", "execution_mode", "cycle_count", "max_cycles", "config", "result", "parent_task_id", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;