import { sql } from 'drizzle-orm';
import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { Permission } from './permissions';

/** The built-in role with every permission. Created by the migration, and never edited or deleted. */
export const SUPER_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000001';

export const roles = pgTable(
  'roles',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 50 }).notNull(),
    description: text().notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // Names are unique ignoring case, so that "Staff" and "staff" cannot both exist.
  (table) => [uniqueIndex('roles_name_key').on(sql`lower(${table.name})`)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text().$type<Permission>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permission] })],
);

export type Role = typeof roles.$inferSelect;
