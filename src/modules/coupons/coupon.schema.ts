import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.schema';
import { orders } from '../orders/order.schema';

export const couponDiscountType = pgEnum('coupon_discount_type', [
  'percent',
  'fixed',
  'free_shipping',
]);

export const coupons = pgTable(
  'coupons',
  {
    id: uuid().primaryKey().defaultRandom(),
    // Saved in capitals, so codes match whatever case shoppers type.
    code: varchar({ length: 32 }).notNull(),
    discountType: couponDiscountType('discount_type').notNull(),
    // A percentage from 1 to 100, or an amount in cents. Null for free shipping.
    discountValue: integer('discount_value'),
    maxDiscountCents: integer('max_discount_cents'),
    minSubtotalCents: integer('min_subtotal_cents'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    usageLimit: integer('usage_limit'),
    perCustomerLimit: integer('per_customer_limit').default(1),
    allowSaleItems: boolean('allow_sale_items').notNull().default(false),
    allowGuests: boolean('allow_guests').notNull().default(true),
    // Applies without a code whenever the cart qualifies. Its code is the label shoppers see.
    isAutomatic: boolean('is_automatic').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('coupons_code_key').on(table.code)],
);

/** One row per order that used a coupon. Cancelling the order deletes it, giving the use back. */
export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    orderId: uuid('order_id')
      .primaryKey()
      .references(() => orders.id, { onDelete: 'cascade' }),
    // A used coupon cannot be deleted, only turned off.
    couponId: uuid('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    guestEmail: varchar('guest_email', { length: 255 }),
    // What the shopper saved, including waived shipping.
    discountCents: bigint('discount_cents', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('coupon_redemptions_coupon_id_idx').on(table.couponId)],
);

export type Coupon = typeof coupons.$inferSelect;
