CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(50) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_key" ON "roles" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "roles" ("id", "name", "description") VALUES
	('00000000-0000-4000-8000-000000000001', 'Super admin', 'Every permission, including ones added later, and manages roles'),
	(gen_random_uuid(), 'Admin', 'Runs the store, apart from roles'),
	(gen_random_uuid(), 'Staff', 'Handles orders and stock');--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", unnest(ARRAY[
	'orders.view', 'orders.manage', 'orders.refund', 'products.view', 'products.manage',
	'inventory.manage', 'categories.manage', 'blogs.manage', 'assets.manage',
	'payment_methods.manage', 'reports.operations', 'reports.sales', 'audit_logs.view'
]) FROM "roles" WHERE "name" = 'Admin';--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", unnest(ARRAY[
	'orders.view', 'orders.manage', 'products.view', 'inventory.manage', 'assets.manage',
	'reports.operations'
]) FROM "roles" WHERE "name" = 'Staff';--> statement-breakpoint
-- Existing admins keep the access they had. Make the first super admin with `npm run db:set-role`.
UPDATE "users" SET "role_id" = (SELECT "id" FROM "roles" WHERE "name" = 'Admin') WHERE "role" = 'admin';
