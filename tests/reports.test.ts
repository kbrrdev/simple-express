import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import {
  categories,
  orderItems,
  orders,
  products,
  productVariants,
  SUPER_ADMIN_ROLE_ID,
  users,
} from '../src/db/schema';

const password = 'correct-horse-battery';
const march = { from: '2026-03-01', to: '2026-03-31' };

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminToken: string;
let customerToken: string;
let customerId: string;
let shirtId: string;
let shoesId: string;

async function registerAndLogin(email: string) {
  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

interface SeedOrder {
  createdAt: string;
  status: (typeof orders.$inferInsert)['status'];
  paymentStatus?: (typeof orders.$inferInsert)['paymentStatus'];
  paidAt?: string;
  totalCents: number;
  taxCents: number;
  taxRateBasisPoints?: number;
  variantId: string;
  quantity: number;
}

/** Inserts an order as checkout would have saved it, at a fixed time. */
async function insertOrder(order: SeedOrder) {
  const [row] = await db
    .insert(orders)
    .values({
      userId: customerId,
      idempotencyKey: randomUUID(),
      status: order.status,
      paymentType: order.paidAt ? 'manual' : 'cod',
      paymentStatus: order.paymentStatus ?? 'unpaid',
      paidAt: order.paidAt ? new Date(order.paidAt) : null,
      subtotalCents: order.totalCents - 1000,
      shippingCents: 1000,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      taxRateBasisPoints: order.taxRateBasisPoints ?? 1200,
      pricesIncludeTax: true,
      recipientName: 'Juan Dela Cruz',
      phone: '+639171234567',
      line1: '123 Rizal Street',
      line2: '',
      barangay: 'San Antonio',
      city: 'Pasig',
      province: 'Metro Manila',
      postalCode: '1605',
      createdAt: new Date(order.createdAt),
    })
    .returning();
  if (!row) throw new Error('Failed to insert order');

  await db.insert(orderItems).values({
    orderId: row.id,
    variantId: order.variantId,
    productName: 'Item',
    unitPriceCents: (order.totalCents - 1000) / order.quantity,
    listPriceCents: (order.totalCents - 1000) / order.quantity,
    quantity: order.quantity,
    taxCents: 0,
    lineTotalCents: order.totalCents - 1000,
  });
}

const getReport = (path: string, query: object = {}) =>
  api().get(`/api/reports/${path}`).query(query).set(bearer(adminToken));

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions, categories, orders cascade`);

  adminToken = await registerAndLogin('admin@example.com');
  await db
    .update(users)
    .set({ roleId: SUPER_ADMIN_ROLE_ID })
    .where(eq(users.email, 'admin@example.com'));
  customerToken = await registerAndLogin('customer@example.com');
  const [customer] = await db.select().from(users).where(eq(users.email, 'customer@example.com'));
  if (!customer) throw new Error('Failed to find customer');
  customerId = customer.id;

  const [category] = await db.insert(categories).values({ name: 'Clothing' }).returning();
  if (!category) throw new Error('Failed to insert category');

  const [shirt, shoes] = await db
    .insert(products)
    .values([
      { categoryId: category.id, name: 'Classic T-Shirt', option1Name: 'Size' },
      { categoryId: category.id, name: 'Trail Runner', active: false },
    ])
    .returning();
  if (!shirt || !shoes) throw new Error('Failed to insert products');

  const [medium, , shoe] = await db
    .insert(productVariants)
    .values([
      { productId: shirt.id, option1Value: 'M', priceCents: 4500, stock: 3 },
      { productId: shirt.id, option1Value: 'L', priceCents: 4500, stock: 10 },
      { productId: shoes.id, priceCents: 19000, stock: 1 },
      { productId: shirt.id, option1Value: 'S', priceCents: 4500, stock: 0, active: false },
    ])
    .returning();
  if (!medium || !shoe) throw new Error('Failed to insert variants');
  shirtId = medium.id;
  shoesId = shoe.id;

  // 10:00 on March 1 in Manila.
  await insertOrder({
    createdAt: '2026-03-01T02:00:00Z',
    status: 'pending',
    totalCents: 10000,
    taxCents: 1071,
    variantId: shirtId,
    quantity: 2,
  });
  // 00:30 on March 2 in Manila, though still March 1 in UTC.
  await insertOrder({
    createdAt: '2026-03-01T16:30:00Z',
    status: 'confirmed',
    paymentStatus: 'paid',
    paidAt: '2026-03-02T03:00:00Z',
    totalCents: 20000,
    taxCents: 2143,
    variantId: shoesId,
    quantity: 1,
  });
  await insertOrder({
    createdAt: '2026-03-03T01:00:00Z',
    status: 'cancelled',
    totalCents: 5000,
    taxCents: 536,
    variantId: shirtId,
    quantity: 1,
  });
  // Placed at a 10% rate, before a change to 12%.
  await insertOrder({
    createdAt: '2026-03-04T01:00:00Z',
    status: 'delivered',
    paymentStatus: 'refunded',
    paidAt: '2026-03-04T02:00:00Z',
    totalCents: 30000,
    taxCents: 2727,
    taxRateBasisPoints: 1000,
    variantId: shoesId,
    quantity: 1,
  });
  // Placed at 23:59 on February 28 in Manila, and paid at 08:00 on March 1.
  await insertOrder({
    createdAt: '2026-02-28T15:59:00Z',
    status: 'delivered',
    paymentStatus: 'paid',
    paidAt: '2026-03-01T00:00:00Z',
    totalCents: 8000,
    taxCents: 857,
    variantId: shirtId,
    quantity: 1,
  });
  await insertOrder({
    createdAt: '2026-04-01T01:00:00Z',
    status: 'awaiting_payment',
    paymentStatus: 'submitted',
    totalCents: 10000,
    taxCents: 1071,
    variantId: shirtId,
    quantity: 2,
  });
});

afterAll(async () => {
  await db.execute(sql`truncate table users, sessions, categories, orders cascade`);
  await pool.end();
});

describe('access', () => {
  it('requires a token', async () => {
    await api().get('/api/reports/summary').expect(401);
  });

  it('is limited to admins', async () => {
    await api().get('/api/reports/summary').set(bearer(customerToken)).expect(403);
    await api().get('/api/reports/low-stock').set(bearer(customerToken)).expect(403);
  });
});

describe('summary', () => {
  it('totals the range', async () => {
    const response = await getReport('summary', march).expect(200);

    expect(response.body.data).toEqual({
      ...march,
      ordersPlaced: 4,
      cancelledOrders: 1,
      grossSalesCents: 60000,
      averageOrderValueCents: 20000,
      itemsSold: 4,
      collectedCents: 58000,
      refundedCents: 30000,
      netCollectedCents: 28000,
      taxCents: 5941,
      shippingCents: 3000,
      discountCents: 0,
      saleDiscountCents: 0,
      couponDiscountCents: 0,
      promotionDiscountCents: 0,
      newCustomers: 0,
      taxByRate: [
        { ratePercent: 10, pricesIncludeTax: true, taxableCents: 27273, taxCents: 2727 },
        { ratePercent: 12, pricesIncludeTax: true, taxableCents: 26786, taxCents: 3214 },
      ],
    });
  });

  it('counts days in Manila time', async () => {
    const response = await getReport('summary', { from: '2026-03-01', to: '2026-03-01' });

    expect(response.body.data).toMatchObject({
      ordersPlaced: 1,
      grossSalesCents: 10000,
      collectedCents: 8000,
    });
  });

  it('covers the last 30 days by default', async () => {
    const response = await getReport('summary').expect(200);
    const { from, to } = response.body.data;

    expect((Date.parse(to) - Date.parse(from)) / 86400000).toBe(29);
    expect(response.body.data.newCustomers).toBe(1);
  });

  it('rejects bad dates', async () => {
    await getReport('summary', { from: '2026-03-02', to: '2026-03-01' }).expect(400);
    await getReport('summary', { from: '2026-02-30' }).expect(400);
    await getReport('summary', { from: 'yesterday' }).expect(400);
  });
});

describe('sales', () => {
  it('returns a point for every day, including empty ones', async () => {
    const response = await getReport('sales', { from: '2026-03-01', to: '2026-03-04' }).expect(200);

    expect(response.body.data.points).toEqual([
      { date: '2026-03-01', orders: 1, grossSalesCents: 10000, collectedCents: 8000 },
      { date: '2026-03-02', orders: 1, grossSalesCents: 20000, collectedCents: 20000 },
      { date: '2026-03-03', orders: 0, grossSalesCents: 0, collectedCents: 0 },
      { date: '2026-03-04', orders: 1, grossSalesCents: 30000, collectedCents: 30000 },
    ]);
  });

  it('groups by month', async () => {
    const response = await getReport('sales', {
      from: '2026-02-01',
      to: '2026-03-31',
      interval: 'month',
    }).expect(200);

    expect(response.body.data.points).toEqual([
      { date: '2026-02-01', orders: 1, grossSalesCents: 8000, collectedCents: 0 },
      { date: '2026-03-01', orders: 3, grossSalesCents: 60000, collectedCents: 58000 },
    ]);
  });

  it('starts weeks on Monday', async () => {
    const response = await getReport('sales', {
      from: '2026-03-01',
      to: '2026-03-04',
      interval: 'week',
    }).expect(200);

    expect(response.body.data.points.map((point: { date: string }) => point.date)).toEqual([
      '2026-02-23',
      '2026-03-02',
    ]);
  });

  it('limits a daily report to 366 days', async () => {
    await getReport('sales', { from: '2025-01-01', to: '2026-01-01' }).expect(200);
    await getReport('sales', { from: '2025-01-01', to: '2026-01-02' }).expect(400);
    await getReport('sales', {
      from: '2020-01-01',
      to: '2026-01-02',
      interval: 'month',
    }).expect(200);
  });
});

describe('top products', () => {
  it('sorts by quantity, leaving out cancelled orders', async () => {
    const response = await getReport('top-products', march).expect(200);

    expect(response.body.data.items).toEqual([
      expect.objectContaining({ name: 'Classic T-Shirt', quantity: 2, revenueCents: 9000 }),
      expect.objectContaining({
        name: 'Trail Runner',
        active: false,
        quantity: 2,
        revenueCents: 48000,
      }),
    ]);
  });

  it('sorts by revenue', async () => {
    const response = await getReport('top-products', { ...march, sort: 'revenue', limit: 1 });

    expect(response.body.data.items).toEqual([
      expect.objectContaining({ name: 'Trail Runner', revenueCents: 48000 }),
    ]);
  });
});

describe('order status', () => {
  it('counts every order and what needs doing', async () => {
    const response = await getReport('order-status').expect(200);

    expect(response.body.data.counts).toEqual([
      { status: 'awaiting_payment', paymentStatus: 'submitted', count: 1 },
      { status: 'pending', paymentStatus: 'unpaid', count: 1 },
      { status: 'confirmed', paymentStatus: 'paid', count: 1 },
      { status: 'delivered', paymentStatus: 'paid', count: 1 },
      { status: 'delivered', paymentStatus: 'refunded', count: 1 },
      { status: 'cancelled', paymentStatus: 'unpaid', count: 1 },
    ]);
    expect(response.body.data.needsAttention).toEqual({
      paymentsToConfirm: 1,
      ordersToConfirm: 1,
      ordersToShip: 1,
    });
  });
});

describe('low stock', () => {
  it('lists variants on sale at or below the threshold', async () => {
    const response = await getReport('low-stock').expect(200);

    expect(response.body.data).toEqual([
      expect.objectContaining({ variantId: shirtId, option1Value: 'M', stock: 3 }),
    ]);
    expect(response.body.meta).toEqual({ page: 1, limit: 20, total: 1 });
  });

  it('uses the threshold given', async () => {
    const response = await getReport('low-stock', { threshold: 10 }).expect(200);

    expect(response.body.data.map((item: { stock: number }) => item.stock)).toEqual([3, 10]);
  });
});
