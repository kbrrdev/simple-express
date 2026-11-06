import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { assets } from '../assets/asset.schema';
import { users } from '../auth/auth.schema';
import { productVariants } from '../products/product.schema';

// These belong to the store. A future payment provider's statuses are mapped onto them.
export const orderStatus = pgEnum('order_status', [
  'awaiting_payment',
  'pending',
  'confirmed',
  'shipped',
  'delivered',
  'returned',
  'cancelled',
]);

export const paymentStatus = pgEnum('payment_status', ['unpaid', 'submitted', 'paid', 'refunded']);

export const paymentMethod = pgEnum('payment_method', ['cod', 'gcash', 'bank_transfer']);

export const orders = pgTable(
  'orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderNumber: integer('order_number').notNull().generatedAlwaysAsIdentity(),
    // Kept when a user is deleted, as orders are business records.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    guestEmail: varchar('guest_email', { length: 255 }),
    idempotencyKey: uuid('idempotency_key').notNull(),
    status: orderStatus().notNull(),
    paymentMethod: paymentMethod('payment_method').notNull(),
    paymentStatus: paymentStatus('payment_status').notNull().default('unpaid'),
    paymentDueAt: timestamp('payment_due_at', { withTimezone: true }),
    subtotalCents: integer('subtotal_cents').notNull(),
    shippingCents: integer('shipping_cents').notNull(),
    taxCents: integer('tax_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    taxRateBasisPoints: integer('tax_rate_basis_points').notNull(),
    pricesIncludeTax: boolean('prices_include_tax').notNull(),
    recipientName: varchar('recipient_name', { length: 100 }).notNull(),
    phone: varchar({ length: 13 }).notNull(),
    line1: varchar({ length: 255 }).notNull(),
    line2: varchar({ length: 255 }).notNull(),
    barangay: varchar({ length: 100 }).notNull(),
    city: varchar({ length: 100 }).notNull(),
    province: varchar({ length: 100 }).notNull(),
    postalCode: varchar('postal_code', { length: 4 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('orders_order_number_unique').on(table.orderNumber),
    unique('orders_user_idempotency_key_unique').on(table.userId, table.idempotencyKey),
    unique('orders_guest_idempotency_key_unique').on(table.guestEmail, table.idempotencyKey),
    index('orders_user_id_created_at_idx').on(table.userId, table.createdAt),
    index('orders_status_idx').on(table.status),
    index('orders_payment_due_at_idx').on(table.paymentDueAt),
    check('orders_total_cents_non_negative', sql`${table.totalCents} >= 0`),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    // Past orders block deleting what they refer to. Their details are copied below.
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'restrict' }),
    productName: varchar('product_name', { length: 255 }).notNull(),
    option1Name: varchar('option1_name', { length: 50 }),
    option1Value: varchar('option1_value', { length: 100 }),
    option2Name: varchar('option2_name', { length: 50 }),
    option2Value: varchar('option2_value', { length: 100 }),
    unitPriceCents: integer('unit_price_cents').notNull(),
    quantity: integer().notNull(),
    taxCents: integer('tax_cents').notNull(),
    lineTotalCents: integer('line_total_cents').notNull(),
  },
  (table) => [index('order_items_order_id_idx').on(table.orderId)],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    method: paymentMethod().notNull(),
    amountCents: integer('amount_cents').notNull(),
    // Enough for a future provider: its name, its reference, and its own raw status.
    provider: varchar({ length: 50 }).notNull(),
    reference: varchar({ length: 100 }).notNull(),
    providerStatus: varchar('provider_status', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('payments_order_id_unique').on(table.orderId),
    unique('payments_provider_reference_unique').on(table.provider, table.reference),
  ],
);

export type Order = typeof orders.$inferSelect;
export type OrderStatus = Order['status'];
