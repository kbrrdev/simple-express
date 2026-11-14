import { boolean, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const pages = pgTable('pages', {
  id: uuid().primaryKey().defaultRandom(),
  slug: varchar({ length: 100 }).notNull().unique(),
  title: varchar({ length: 255 }).notNull(),
  content: text().notNull(),
  published: boolean().notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Page = typeof pages.$inferSelect;
