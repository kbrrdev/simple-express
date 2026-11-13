import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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

export const saleDiscountType = pgEnum('sale_discount_type', ['percent', 'fixed']);

export const sales = pgTable(
  'sales',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 100 }).notNull(),
    discountType: saleDiscountType('discount_type').notNull(),
    // A percentage from 1 to 90, or an amount in cents.
    discountValue: integer('discount_value').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    // Units that can sell at the sale price, across every product in the sale.
    stockCap: integer('stock_cap'),
    soldCount: integer('sold_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check('sales_discount_value_positive', sql`${table.discountValue} > 0`),
    check(
      'sales_sold_count_within_cap',
      sql`${table.soldCount} >= 0 and (${table.stockCap} is null or ${table.soldCount} <= ${table.stockCap})`,
    ),
  ],
);

export const saleProducts = pgTable(
  'sale_products',
  {
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.saleId, table.productId] })],
);

export const saleCategories = pgTable(
  'sale_categories',
  {
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.saleId, table.categoryId] })],
);

export type Sale = typeof sales.$inferSelect;
