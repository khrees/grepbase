DROP INDEX `commits_sha_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `commits_repo_sha_unique` ON `commits` (`repo_id`,`sha`);