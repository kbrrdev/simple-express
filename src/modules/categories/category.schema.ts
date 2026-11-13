import { type AnyPgColumn, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { assets } from '../assets/asset.schema';

export const categories = pgTable(
  'categories',
  {
    id: uuid().primaryKey().defaultRandom(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
      onDelete: 'restrict',
    }),
    name: varchar({ length: 100 }).notNull(),
    imageAssetId: uuid('image_asset_id').references(() => assets.id, { onDelete: 'restrict' }),
    // A name from the frontend's icon set, such as Lucide's. Frontends show it before the image.
    icon: varchar({ length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // Names repeat across branches, such as Men > Shoes and Women > Shoes, but not among siblings.
  // Nulls count as equal, so that top-level names are unique too.
  (table) => [
    unique('categories_parent_id_name_unique').on(table.parentId, table.name).nullsNotDistinct(),
  ],
);

export type Category = typeof categories.$inferSelect;
