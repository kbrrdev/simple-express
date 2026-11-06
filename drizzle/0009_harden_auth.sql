CREATE TABLE "login_attempts" (
	"email" varchar(255) PRIMARY KEY NOT NULL,
	"failed_count" integer DEFAULT 1 NOT NULL,
	"last_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "sessions_previous_refresh_token_hash_idx";--> statement-breakpoint
CREATE INDEX "login_attempts_last_failed_at_idx" ON "login_attempts" USING btree ("last_failed_at");