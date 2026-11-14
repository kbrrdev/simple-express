import { index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { roles } from '../roles/role.schema';

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar({ length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  // Customers have no role. Staff roles are managed by super admins.
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'restrict' }),
  // When the customer accepted the terms on registering, if the client sent acceptTerms.
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: varchar('refresh_token_hash', { length: 64 }).notNull().unique(),
    previousRefreshTokenHash: varchar('previous_refresh_token_hash', { length: 64 }),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    email: varchar({ length: 255 }).primaryKey(),
    failedCount: integer('failed_count').notNull().default(1),
    lastFailedAt: timestamp('last_failed_at', { withTimezone: true }).notNull().defaultNow(),
    blockedUntil: timestamp('blocked_until', { withTimezone: true }),
  },
  (table) => [index('login_attempts_last_failed_at_idx').on(table.lastFailedAt)],
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('password_resets_user_id_idx').on(table.userId)],
);
