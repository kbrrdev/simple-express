CREATE TYPE "public"."coupon_discount_type" AS ENUM('percent', 'fixed', 'free_shipping');--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"coupon_id" uuid NOT NULL,
	"user_id" uuid,
	"guest_email" varchar(255),
	"discount_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"discount_type" "coupon_discount_type" NOT NULL,
	"discount_value" integer,
	"max_discount_cents" integer,
	"min_subtotal_cents" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"per_customer_limit" integer DEFAULT 1,
	"allow_sale_items" boolean DEFAULT false NOT NULL,
	"allow_guests" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "discount_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_code" varchar(32);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_id_idx" ON "coupon_redemptions" USING btree ("coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons" USING btree ("code");