import { boolean, pgEnum, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { assets } from '../assets/asset.schema';

// Manual methods are accounts customers send money to. A provider would add a type here.
export const paymentMethodType = pgEnum('payment_method_type', ['manual']);

export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid().primaryKey().defaultRandom(),
    type: paymentMethodType().notNull().default('manual'),
    providerName: varchar('provider_name', { length: 100 }).notNull(),
    accountName: varchar('account_name', { length: 100 }).notNull(),
    accountNumber: varchar('account_number', { length: 100 }).notNull(),
    qrAssetId: uuid('qr_asset_id').references(() => assets.id, { onDelete: 'restrict' }),
    enabled: boolean().notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('payment_methods_provider_account_unique').on(table.providerName, table.accountNumber),
  ],
);

export type PaymentMethod = typeof paymentMethods.$inferSelect;
