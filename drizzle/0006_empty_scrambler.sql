ALTER TABLE `tasks` ADD `execution_mode` text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `cycle_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `max_cycles` integer DEFAULT 10 NOT NULL;