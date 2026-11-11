import { spawnSync } from 'node:child_process';
import { count, sql } from 'drizzle-orm';
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

    const statuses = await db
      .select({ status: orders.status, paymentStatus: orders.paymentStatus })
      .from(orders)
      .orderBy(orders.orderNumber);

    expect(statuses).toEqual([
      { status: 'delivered', paymentStatus: 'paid' },
      { status: 'confirmed', paymentStatus: 'paid' },
      { status: 'awaiting_payment', paymentStatus: 'submitted' },
      { status: 'awaiting_payment', paymentStatus: 'unpaid' },
      { status: 'cancelled', paymentStatus: 'unpaid' },
      { status: 'awaiting_payment', paymentStatus: 'unpaid' },
    ]);
  }, 60000);

  it('refuses to run twice', () => {
    const result = runSeed();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('already has users');
  }, 30000);
});
