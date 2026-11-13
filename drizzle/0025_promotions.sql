CREATE TYPE "public"."promotion_type" AS ENUM('buy_x_get_y', 'bundle');--> statement-breakpoint
CREATE TABLE "promotion_categories" (
	"promotion_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "promotion_categories_promotion_id_category_id_pk" PRIMARY KEY("promotion_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "promotion_products" (
	"promotion_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "promotion_products_promotion_id_product_id_pk" PRIMARY KEY("promotion_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" "promotion_type" NOT NULL,
	"buy_quantity" integer,
	"get_quantity" integer,
	"get_percent_off" integer,
	"discount_type" "sale_discount_type",
	"discount_value" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "promotion_discount_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "promotion_name" varchar(100);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "promotion_discount_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "promotion_categories" ADD CONSTRAINT "promotion_categories_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_categories" ADD CONSTRAINT "promotion_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;