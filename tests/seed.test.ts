import { spawnSync } from 'node:child_process';
import { and, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db';
import {
  addresses,
  assets,
  blogs,
  cartItems,
  categories,
  orderItems,
  orders,
  paymentMethods,
  payments,
  productImages,
  products,
  productVariants,
  users,
} from '../src/db/schema';

const clearDatabase = () =>
  db.execute(
    sql`truncate table users, sessions, categories, assets, payment_methods, blogs, orders cascade`,
  );

/** Runs the real script, as `npm run db:seed` would. */
function runSeed(env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/db/seed.ts'], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

beforeAll(async () => {
  await clearDatabase();
}, 30000);

afterAll(async () => {
  await clearDatabase();
  await pool.end();
});

describe('seed', () => {
  it('refuses to run in production', () => {
    const result = runSeed({ APP_ENV: 'production' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not allowed in production');
  }, 30000);

  it('fills every table it covers', async () => {
    const result = runSeed();

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const tables = [
      users,
      addresses,
      assets,
      categories,
      products,
      productVariants,
      productImages,
      paymentMethods,
      blogs,
      cartItems,
      orders,
      orderItems,
      payments,
    ];

    for (const table of tables) {
      const [row] = await db.select({ total: count() }).from(table);
      expect(row?.total).toBeGreaterThan(0);
    }

    const rows = await db
      .selectDistinct({
        paymentType: orders.paymentType,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
      })
      .from(orders);
    const combinations = rows.map((row) => `${row.paymentType} ${row.status} ${row.paymentStatus}`);

    expect(combinations.sort()).toEqual(
      [
        'cod pending unpaid',
        'cod confirmed unpaid',
        'cod shipped unpaid',
        'cod delivered paid',
        'cod delivered refunded',
        'cod returned unpaid',
        'cod cancelled unpaid',
        'manual awaiting_payment unpaid',
        'manual awaiting_payment submitted',
        'manual pending paid',
        'manual confirmed paid',
        'manual shipped paid',
        'manual delivered paid',
        'manual delivered refunded',
        'manual returned paid',
        'manual returned refunded',
        'manual cancelled unpaid',
        'manual cancelled paid',
        'manual cancelled refunded',
      ].sort(),
    );

    const [rejected] = await db
      .select({ total: count() })
      .from(orders)
      .innerJoin(payments, eq(payments.orderId, orders.id))
      .where(and(eq(orders.status, 'cancelled'), eq(orders.paymentStatus, 'unpaid')));

    expect(rejected?.total).toBe(1);

    const lines = await db.select({ total: count() }).from(orderItems).groupBy(orderItems.orderId);
    const multiItem = lines.filter((row) => row.total > 1);

    expect(multiItem.length).toBeGreaterThan(lines.length / 2);
  }, 60000);

  it('refuses to run twice', () => {
    const result = runSeed();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('already has users');
  }, 30000);
});
