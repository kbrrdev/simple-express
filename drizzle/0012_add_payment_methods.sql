CREATE TYPE "public"."payment_type" AS ENUM('cod', 'manual');--> statement-breakpoint
CREATE TYPE "public"."payment_method_type" AS ENUM('manual');--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "payment_method_type" DEFAULT 'manual' NOT NULL,
	"provider_name" varchar(100) NOT NULL,
	"account_name" varchar(100) NOT NULL,
	"account_number" varchar(100) NOT NULL,
	"qr_asset_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_provider_account_unique" UNIQUE("provider_name","account_number")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_type" "payment_type";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_provider" varchar(100);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_account_name" varchar(100);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_account_number" varchar(100);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_qr_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_qr_asset_id_assets_id_fk" FOREIGN KEY ("qr_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_qr_asset_id_assets_id_fk" FOREIGN KEY ("payment_qr_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
UPDATE "orders" SET
  "payment_type" = CASE WHEN "payment_method" = 'cod' THEN 'cod'::"payment_type" ELSE 'manual'::"payment_type" END,
  "payment_provider" = CASE "payment_method" WHEN 'gcash' THEN 'GCash' WHEN 'bank_transfer' THEN 'Bank transfer' END;
