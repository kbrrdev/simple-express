import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { assets } from '../assets/asset.schema';
import { categories } from '../categories/category.schema';

export const products = pgTable(
  'products',
  {
    id: uuid().primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    name: varchar({ length: 255 }).notNull(),
    description: text().notNull().default(''),
    option1Name: varchar('option1_name', { length: 50 }),
    option2Name: varchar('option2_name', { length: 50 }),
    active: boolean().notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('products_category_id_idx').on(table.categoryId),
    check(
      'products_option2_requires_option1',
      sql`${table.option2Name} is null or ${table.option1Name} is not null`,
    ),
  ],
);

export const productImages = pgTable(
  'product_images',
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict' }),
    altText: varchar('alt_text', { length: 255 }).notNull().default(''),
    position: integer().notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('product_images_product_asset_unique').on(table.productId, table.assetId)],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    option1Value: varchar('option1_value', { length: 100 }),
    option2Value: varchar('option2_value', { length: 100 }),
    assetId: uuid('asset_id'),
    priceCents: integer('price_cents').notNull(),
    stock: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Without NULLS NOT DISTINCT, a product with no options could have duplicate variants.
    unique('product_variants_options_unique')
      .on(table.productId, table.option1Value, table.option2Value)
      .nullsNotDistinct(),
    check('product_variants_price_cents_non_negative', sql`${table.priceCents} >= 0`),
    check('product_variants_stock_non_negative', sql`${table.stock} >= 0`),
    // Keeps a variant's image on its own product, and blocks removing an image in use.
    foreignKey({
      name: 'product_variants_image_fk',
      columns: [table.productId, table.assetId],
      foreignColumns: [productImages.productId, productImages.assetId],
    }),
  ],
);

export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
