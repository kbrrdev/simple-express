import { jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const socialPlatforms = [
  'facebook',
  'instagram',
  'tiktok',
  'youtube',
  'x',
  'messenger',
  'viber',
  'whatsapp',
  'shopee',
  'lazada',
] as const;

export type SocialPlatform = (typeof socialPlatforms)[number];

export interface SocialLink {
  platform: SocialPlatform;
  url: string;
  label: string | null;
}

// The table has one row, created by its migration with this ID.
export const STORE_INFO_ID = '00000000-0000-4000-8000-000000000002';

export const storeInfo = pgTable('store_info', {
  id: uuid().primaryKey(),
  name: varchar({ length: 100 }).notNull(),
  email: varchar({ length: 255 }),
  phone: varchar({ length: 30 }),
  line1: varchar({ length: 255 }),
  line2: varchar({ length: 255 }),
  barangay: varchar({ length: 100 }),
  city: varchar({ length: 100 }),
  province: varchar({ length: 100 }),
  postalCode: varchar('postal_code', { length: 4 }),
  businessHours: varchar('business_hours', { length: 200 }),
  // In display order.
  socialLinks: jsonb('social_links').$type<SocialLink[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type StoreInfo = typeof storeInfo.$inferSelect;
