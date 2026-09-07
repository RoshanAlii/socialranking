CREATE TABLE `auth_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refresh_locks` (
	`month` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL,
	`status` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`month` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`captured` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL
);
