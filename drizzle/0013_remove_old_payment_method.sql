ALTER TABLE "orders" ALTER COLUMN "payment_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "payment_method";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "method";--> statement-breakpoint
DROP TYPE "public"."payment_method";