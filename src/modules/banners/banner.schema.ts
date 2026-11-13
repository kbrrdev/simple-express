import { boolean, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { assets } from '../assets/asset.schema';

export const banners = pgTable('banners', {
  id: uuid().primaryKey().defaultRandom(),
  assetId: uuid('asset_id')
    .notNull()
    .references(() => assets.id, { onDelete: 'restrict' }),
  // Shown on phones when set, and the default image otherwise.
  mobileAssetId: uuid('mobile_asset_id').references(() => assets.id, { onDelete: 'restrict' }),
  altText: varchar('alt_text', { length: 200 }).notNull(),
  title: varchar({ length: 100 }),
  subtitle: varchar({ length: 200 }),
  linkUrl: varchar('link_url', { length: 500 }),
  position: integer().notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Banner = typeof banners.$inferSelect;
