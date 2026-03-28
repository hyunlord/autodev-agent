CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`attempt_num` integer NOT NULL,
	`agent_id` text NOT NULL,
	`phase` text NOT NULL,
	`status` text NOT NULL,
	`input` text,
	`output` text,
	`error_log` text,
	`error_hash` text,
	`cost_usd` real,
	`token_count` integer,
	`duration_ms` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`type` text NOT NULL,
	`data` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`project_dir` text,
	`project_type` text,
	`config` text,
	`result` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`check_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`expected` text,
	`actual` text,
	`screenshot_path` text,
	`vlm_feedback` text,
	`vlm_confidence` real,
	`duration_ms` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
