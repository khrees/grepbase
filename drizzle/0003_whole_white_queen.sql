ALTER TABLE `repositories` ADD `last_ingested_sha` text;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `last_seen_head_sha` text;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `last_fetch_at` integer;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `fetch_interval_minutes` integer DEFAULT 60;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `last_ingest_error` text;
--> statement-breakpoint
ALTER TABLE `commits` ADD `in_default_lineage` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_commits_repo_lineage_order` ON `commits` (`repo_id`,`in_default_lineage`,`order`);
