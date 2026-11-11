ALTER TABLE "orders" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_paid_at_idx" ON "orders" USING btree ("paid_at");--> statement-breakpoint
-- Orders paid before this column existed have no record of when. updated_at is the closest guess.
UPDATE "orders" SET "paid_at" = "updated_at" WHERE "payment_status" IN ('paid', 'refunded');
