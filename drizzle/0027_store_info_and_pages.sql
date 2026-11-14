CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "store_info" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"email" varchar(255),
	"phone" varchar(30),
	"line1" varchar(255),
	"line2" varchar(255),
	"barangay" varchar(100),
	"city" varchar(100),
	"province" varchar(100),
	"postal_code" varchar(4),
	"business_hours" varchar(200),
	"social_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
-- The only row, with the fixed ID in store-info.schema.ts. The CMS fills in the rest.
INSERT INTO "store_info" ("id", "name") VALUES ('00000000-0000-4000-8000-000000000002', 'My Store')
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- The built-in Admin role runs the store, so it manages the store info and pages too.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", "permission" FROM "roles", (VALUES ('store.manage'), ('pages.manage')) AS p("permission")
WHERE "name" = 'Admin'
ON CONFLICT DO NOTHING;
