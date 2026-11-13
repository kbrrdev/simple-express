CREATE TYPE "public"."sale_discount_type" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TABLE "sale_categories" (
	"sale_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "sale_categories_sale_id_category_id_pk" PRIMARY KEY("sale_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "sale_products" (
	"sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "sale_products_sale_id_product_id_pk" PRIMARY KEY("sale_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"discount_type" "sale_discount_type" NOT NULL,
	"discount_value" integer NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"stock_cap" integer,
	"sold_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_discount_value_positive" CHECK ("sales"."discount_value" > 0),
	CONSTRAINT "sales_sold_count_within_cap" CHECK ("sales"."sold_count" >= 0 and ("sales"."stock_cap" is null or "sales"."sold_count" <= "sales"."stock_cap"))
);
--> statement-breakpoint
-- Past orders had no sales, so they were sold at their list price.
ALTER TABLE "order_items" ADD COLUMN "list_price_cents" integer;--> statement-breakpoint
UPDATE "order_items" SET "list_price_cents" = "unit_price_cents";--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "list_price_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_categories" ADD CONSTRAINT "sale_categories_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_categories" ADD CONSTRAINT "sale_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_products" ADD CONSTRAINT "sale_products_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_products" ADD CONSTRAINT "sale_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The built-in Admin role runs the store, so it manages sales too.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'promotions.manage' FROM "roles" WHERE "name" = 'Admin'
ON CONFLICT DO NOTHING;
