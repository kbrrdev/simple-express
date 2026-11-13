import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { categories } from '../categories/category.schema';
import { products } from '../products/product.schema';
import { saleDiscountType } from '../sales/sale.schema';

export const promotionType = pgEnum('promotion_type', ['buy_x_get_y', 'bundle']);

/** Discounts on items bought together in one cart, as opposed to sales, which change prices. */
export const promotions = pgTable('promotions', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 100 }).notNull(),
  type: promotionType().notNull(),
  // Buy X get Y: every buyQuantity + getQuantity units, the cheapest getQuantity are discounted.
  buyQuantity: integer('buy_quantity'),
  getQuantity: integer('get_quantity'),
  getPercentOff: integer('get_percent_off'),
  // Bundle: taken off each complete set of the bundle's products.
  discountType: saleDiscountType('discount_type'),
  discountValue: integer('discount_value'),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const promotionProducts = pgTable(
  'promotion_products',
  {
    promotionId: uuid('promotion_id')
      .notNull()
      .references(() => promotions.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.promotionId, table.productId] })],
);

export const promotionCategories = pgTable(
  'promotion_categories',
  {
    promotionId: uuid('promotion_id')
      .notNull()
      .references(() => promotions.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.promotionId, table.categoryId] })],
);

export type Promotion = typeof promotions.$inferSelect;
