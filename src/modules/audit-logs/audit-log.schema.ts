import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.schema';

export const auditEntityTypes = [
  'asset',
  'banner',
  'blog',
  'category',
  'coupon',
  'order',
  'payment_method',
  'product',
  'product_image',
  'promotion',
  'role',
  'sale',
  'user',
  'variant',
] as const;

export type AuditEntityType = (typeof auditEntityTypes)[number];

/** Each changed field, as `[before, after]`. Created rows have `null` before, deleted rows after. */
export type AuditChanges = Record<string, [unknown, unknown]>;

// The API's database role can only insert and read these rows. See `src/db/migrate.ts`.
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid().primaryKey().defaultRandom(),
    // Null when a script or timer made the change.
    actorUserId: uuid('actor_user_id').references(() => users.id),
    entityType: text('entity_type').$type<AuditEntityType>().notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text().notNull(),
    changes: jsonb().$type<AuditChanges>().notNull(),
    requestId: uuid('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_created_at_idx').on(table.createdAt),
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),
    index('audit_logs_actor_user_id_idx').on(table.actorUserId),
  ],
);
