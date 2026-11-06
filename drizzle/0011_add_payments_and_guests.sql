CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_cents" integer NOT NULL,
	"provider" varchar(50) NOT NULL,
	"reference" varchar(100) NOT NULL,
	"provider_status" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "payments_provider_reference_unique" UNIQUE("provider","reference")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "guest_email" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_payment_due_at_idx" ON "orders" USING btree ("payment_due_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_guest_idempotency_key_unique" UNIQUE("guest_email","idempotency_key");