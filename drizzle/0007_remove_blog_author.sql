ALTER TABLE "blogs" DROP CONSTRAINT "blogs_author_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "blogs" DROP COLUMN "author_id";