CREATE TABLE "banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"mobile_asset_id" uuid,
	"alt_text" varchar(200) NOT NULL,
	"title" varchar(100),
	"subtitle" varchar(200),
	"link_url" varchar(500),
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_mobile_asset_id_assets_id_fk" FOREIGN KEY ("mobile_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- The built-in Admin role runs the store, so it manages banners too.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'banners.manage' FROM "roles" WHERE "name" = 'Admin'
ON CONFLICT DO NOTHING;