import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.schema';

export const addresses = pgTable(
  'addresses',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientName: varchar('recipient_name', { length: 100 }).notNull(),
    phone: varchar({ length: 13 }).notNull(),
    line1: varchar({ length: 255 }).notNull(),
    line2: varchar({ length: 255 }).notNull().default(''),
    barangay: varchar({ length: 100 }).notNull(),
    city: varchar({ length: 100 }).notNull(),
    province: varchar({ length: 100 }).notNull(),
    postalCode: varchar('postal_code', { length: 4 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('addresses_user_id_idx').on(table.userId),
    uniqueIndex('addresses_one_default_per_user')
      .on(table.userId)
      .where(sql`${table.isDefault}`),
  ],
);

export type Address = typeof addresses.$inferSelect;
