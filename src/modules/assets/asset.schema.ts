import { integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const assets = pgTable('assets', {
  id: uuid().primaryKey().defaultRandom(),
  path: varchar({ length: 255 }).notNull().unique(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Asset = typeof assets.$inferSelect;
