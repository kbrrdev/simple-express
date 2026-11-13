import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import {
  auditLogs,
  categories,
  products,
  productVariants,
  roles,
  sales,
  SUPER_ADMIN_ROLE_ID,
  users,
} from '../src/db/schema';

const password = 'correct-horse-battery';
const missingId = '00000000-0000-4000-8000-000000000000';
const url = '/api/promotions';
const hour = 60 * 60 * 1000;
const shipping = 10000;

const address = {
  recipientName: 'Juan Dela Cruz',
  phone: '09171234567',
  line1: '123 Rizal Street',
  barangay: 'San Antonio',
  city: 'Pasig',
  province: 'Metro Manila',
  postalCode: '1605',
};

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminToken: string;
let adminRoleToken: string;
let customerToken: string;
let addressId: string;
let menId: string;
let teeId: string;
let flatsId: string;
let small: string;
let large: string;
let flats6: string;
let flats7: string;
let cap: string;

async function registerAndLogin(email: string) {
  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

const buyXGetY = (body: object = {}) =>
  createPromotion({
    name: 'Buy 2 get 1 free',
    type: 'buy_x_get_y',
    buyQuantity: 2,
    getQuantity: 1,
    getPercentOff: 100,
    productIds: [teeId],
    ...body,
  });

const bundle = (body: object = {}) =>
  createPromotion({
    name: 'Tee and flats',
    type: 'bundle',
    discountType: 'percent',
    discountValue: 10,
    productIds: [teeId, flatsId],
    ...body,
  });

async function createPromotion(body: object) {
  const response = await api().post(url).set(bearer(adminToken)).send(body).expect(201);
  return response.body.data;
}

const preview = async (items: object[], body: object = {}) =>
  (
    await api()
      .post('/api/orders/preview')
      .send({ items, ...body })
      .expect(200)
  ).body.data;

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  adminToken = await registerAndLogin('admin@example.com');
  await db
    .update(users)
    .set({ roleId: SUPER_ADMIN_ROLE_ID })
    .where(eq(users.email, 'admin@example.com'));

  const [adminRole] = await db.select().from(roles).where(eq(roles.name, 'Admin'));
  adminRoleToken = await registerAndLogin('store-admin@example.com');
  await db
    .update(users)
    .set({ roleId: adminRole?.id })
    .where(eq(users.email, 'store-admin@example.com'));

  customerToken = await registerAndLogin('customer@example.com');
});

beforeEach(async () => {
  await db.execute(
    sql`truncate table promotions, coupons, sales, categories, products, addresses, orders cascade`,
  );
  await db.execute(sql`truncate table cart_items`);

  const [men] = await db.insert(categories).values({ name: 'Men' }).returning();
  if (!men) throw new Error('Failed to insert category');
  menId = men.id;
  const [shirts] = await db
    .insert(categories)
    .values({ name: 'Shirts', parentId: menId })
    .returning();
  if (!shirts) throw new Error('Failed to insert category');

  const [tee, flats, capProduct] = await db
    .insert(products)
    .values([
      { categoryId: shirts.id, name: 'Tee', option1Name: 'Size' },
      { categoryId: menId, name: 'Flats', option1Name: 'Size' },
      { categoryId: menId, name: 'Cap' },
    ])
    .returning();
  if (!tee || !flats || !capProduct) throw new Error('Failed to insert products');
  teeId = tee.id;
  flatsId = flats.id;

  const variants = await db
    .insert(productVariants)
    .values([
      { productId: teeId, option1Value: 'S', priceCents: 30000, stock: 50 },
      { productId: teeId, option1Value: 'L', priceCents: 40000, stock: 50 },
      { productId: flatsId, option1Value: '6', priceCents: 100000, stock: 50 },
      { productId: flatsId, option1Value: '7', priceCents: 120000, stock: 50 },
      { productId: capProduct.id, priceCents: 20000, stock: 50 },
    ])
    .returning();
  [small, large, flats6, flats7, cap] = variants.map((variant) => variant.id) as [
    string,
    string,
    string,
    string,
    string,
  ];

  addressId = (
    await api().post('/api/addresses').set(bearer(customerToken)).send(address).expect(201)
  ).body.data.id;
});

afterAll(async () => {
  await pool.end();
});

describe('buy X get Y', () => {
  it('discounts the cheapest unit in each complete set', async () => {
    const promotion = await buyXGetY();

    const data = await preview([
      { variantId: small, quantity: 2 },
      { variantId: large, quantity: 1 },
    ]);

    expect(data).toMatchObject({
      subtotalCents: 100000,
      promotionDiscountCents: 30000,
      promotions: [{ id: promotion.id, name: 'Buy 2 get 1 free', discountCents: 30000 }],
      totalCents: 100000 - 30000 + shipping,
    });
  });

  it('gives nothing for a partial set', async () => {
    await buyXGetY();

    const data = await preview([{ variantId: large, quantity: 2 }]);

    expect(data).toMatchObject({ promotionDiscountCents: 0, promotions: [] });
  });

  it('discounts the cheapest units across several sets', async () => {
    await buyXGetY();

    const data = await preview([
      { variantId: small, quantity: 3 },
      { variantId: large, quantity: 3 },
    ]);

    expect(data.promotionDiscountCents).toBe(60000);
  });

  it('can take a percentage off instead of making it free', async () => {
    await buyXGetY({ buyQuantity: 1, getQuantity: 1, getPercentOff: 50 });

    const data = await preview([{ variantId: large, quantity: 2 }]);

    expect(data.promotionDiscountCents).toBe(20000);
  });

  it('covers products in a category and its subcategories', async () => {
    await buyXGetY({ productIds: [], categoryIds: [menId] });

    const data = await preview([
      { variantId: small, quantity: 1 },
      { variantId: cap, quantity: 1 },
      { variantId: flats6, quantity: 1 },
    ]);

    expect(data.promotionDiscountCents).toBe(20000);
  });
});

describe('bundles', () => {
  it('takes the discount off each complete set, priced with the cheapest units', async () => {
    await bundle();

    const data = await preview([
      { variantId: small, quantity: 2 },
      { variantId: flats6, quantity: 1 },
      { variantId: flats7, quantity: 1 },
    ]);

    // Each set is priced as 300 + 1,000, and there are two sets.
    expect(data.promotionDiscountCents).toBe(26000);
  });

  it('can take a fixed amount off each set', async () => {
    await bundle({ discountType: 'fixed', discountValue: 10000 });

    const data = await preview([
      { variantId: small, quantity: 1 },
      { variantId: flats6, quantity: 1 },
    ]);

    expect(data.promotionDiscountCents).toBe(10000);
  });

  it('gives nothing until every product is in the cart', async () => {
    await bundle();

    const data = await preview([{ variantId: small, quantity: 3 }]);

    expect(data.promotionDiscountCents).toBe(0);
  });
});

describe('combining', () => {
  it('gives each line one promotion, largest discount first', async () => {
    const first = await buyXGetY();
    await bundle();

    const data = await preview([
      { variantId: small, quantity: 3 },
      { variantId: flats6, quantity: 1 },
    ]);

    expect(data.promotions).toEqual([
      { id: first.id, name: 'Buy 2 get 1 free', discountCents: 30000 },
    ]);
  });

  it('leaves out items on sale', async () => {
    await buyXGetY();
    const [sale] = await db
      .insert(sales)
      .values({ name: 'Sale', discountType: 'percent', discountValue: 10 })
      .returning();
    await db.execute(sql`insert into sale_products values (${sale?.id}, ${teeId})`);

    const data = await preview([{ variantId: small, quantity: 3 }]);

    expect(data.promotionDiscountCents).toBe(0);
  });

  it('keeps promoted items out of a coupon unless it allows sale items', async () => {
    await buyXGetY();
    for (const [code, allowSaleItems] of [
      ['SAVE10', false],
      ['ANY10', true],
    ] as const) {
      await api()
        .post('/api/coupons')
        .set(bearer(adminToken))
        .send({ code, discountType: 'percent', discountValue: 10, allowSaleItems })
        .expect(201);
    }
    const items = [
      { variantId: small, quantity: 3 },
      { variantId: cap, quantity: 1 },
    ];

    expect((await preview(items, { couponCode: 'SAVE10' })).discountCents).toBe(2000);
    // The tee line is counted after its promotion: 90,000 - 30,000, plus the cap's 20,000.
    expect((await preview(items, { couponCode: 'ANY10' })).discountCents).toBe(8000);
  });
});

describe('orders', () => {
  it('save each line’s promotion, and keep it after the promotion is deleted', async () => {
    const promotion = await buyXGetY();
    for (const variantId of [small, large]) {
      await api()
        .post('/api/cart/items')
        .set(bearer(customerToken))
        .send({ variantId, quantity: variantId === small ? 2 : 1 })
        .expect(200);
    }

    const response = await api()
      .post('/api/orders')
      .set(bearer(customerToken))
      .send({
        addressId,
        paymentMethod: 'cod',
        expectedTotalCents: 100000 - 30000 + shipping,
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    const order = response.body.data;

    expect(order).toMatchObject({ subtotalCents: 100000, promotionDiscountCents: 30000 });
    expect(
      order.items.find((item: { variantId: string }) => item.variantId === small),
    ).toMatchObject({
      promotionName: 'Buy 2 get 1 free',
      promotionDiscountCents: 30000,
      lineTotalCents: 30000,
    });

    await api().delete(`${url}/${promotion.id}`).set(bearer(adminToken)).expect(204);
    const after = await api().get(`/api/orders/${order.id}`).set(bearer(customerToken)).expect(200);
    expect(after.body.data.promotionDiscountCents).toBe(30000);

    const report = await api().get('/api/reports/summary').set(bearer(adminToken)).expect(200);
    expect(report.body.data).toMatchObject({
      promotionDiscountCents: 30000,
      discountCents: 30000,
    });
  });
});

describe('product badges', () => {
  it('show running promotions on public product routes only', async () => {
    const promotion = await buyXGetY({ productIds: [], categoryIds: [menId] });
    await buyXGetY({ name: 'Later', startsAt: new Date(Date.now() + hour).toISOString() });

    const product = await api().get(`/api/products/${teeId}`).expect(200);
    expect(product.body.data.promotions).toEqual([
      { id: promotion.id, name: 'Buy 2 get 1 free', type: 'buy_x_get_y' },
    ]);

    const list = await api().get('/api/products').query({ search: 'Cap' }).expect(200);
    expect(list.body.data[0].promotions).toHaveLength(1);

    const admin = await api()
      .get(`/api/products/admin/${teeId}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(admin.body.data).not.toHaveProperty('promotions');
  });
});

describe('managing promotions', () => {
  it('needs promotions.manage', async () => {
    await api().get(url).expect(401);
    await api().get(url).set(bearer(customerToken)).expect(403);
    await api().get(url).set(bearer(adminRoleToken)).expect(200);
  });

  it('creates, reads, updates, and deletes a promotion', async () => {
    const promotion = await buyXGetY({ discountType: 'percent', discountValue: 5 });

    expect(promotion).toMatchObject({
      type: 'buy_x_get_y',
      buyQuantity: 2,
      getQuantity: 1,
      getPercentOff: 100,
      discountType: null,
      discountValue: null,
      productIds: [teeId],
      categoryIds: [],
    });

    const updated = await api()
      .patch(`${url}/${promotion.id}`)
      .set(bearer(adminToken))
      .send({ name: 'Tee deal', categoryIds: [menId] })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      name: 'Tee deal',
      productIds: [teeId],
      categoryIds: [menId],
    });

    const list = await api().get(url).set(bearer(adminToken)).expect(200);
    expect(list.body.data).toHaveLength(1);

    await api().delete(`${url}/${promotion.id}`).set(bearer(adminToken)).expect(204);
    await api().get(`${url}/${promotion.id}`).set(bearer(adminToken)).expect(404);
  });

  it('rejects invalid promotions', async () => {
    const send = (body: object) => api().post(url).set(bearer(adminToken)).send(body);

    await send({ name: 'X', type: 'buy_x_get_y', buyQuantity: 2, productIds: [teeId] }).expect(400);
    await send({
      name: 'X',
      type: 'buy_x_get_y',
      buyQuantity: 2,
      getQuantity: 1,
      getPercentOff: 100,
    }).expect(400);
    await send({
      name: 'X',
      type: 'bundle',
      discountType: 'percent',
      productIds: [teeId, flatsId],
    }).expect(400);
    await send({
      name: 'X',
      type: 'bundle',
      discountType: 'percent',
      discountValue: 10,
      productIds: [teeId],
    }).expect(400);
    await send({
      name: 'X',
      type: 'bundle',
      discountType: 'percent',
      discountValue: 101,
      productIds: [teeId, flatsId],
    }).expect(400);
    await send({
      name: 'X',
      type: 'bundle',
      discountType: 'percent',
      discountValue: 10,
      productIds: [teeId, flatsId],
      categoryIds: [menId],
    }).expect(400);
    await send({
      name: 'X',
      type: 'buy_x_get_y',
      buyQuantity: 2,
      getQuantity: 1,
      getPercentOff: 100,
      productIds: [missingId],
    }).expect(400);

    await api()
      .patch(`${url}/${missingId}`)
      .set(bearer(adminToken))
      .send({ name: 'Gone' })
      .expect(404);
  });

  it('records each change in the audit log', async () => {
    const promotion = await bundle();
    await api()
      .patch(`${url}/${promotion.id}`)
      .set(bearer(adminToken))
      .send({ discountValue: 15 })
      .expect(200);
    await api().delete(`${url}/${promotion.id}`).set(bearer(adminToken)).expect(204);

    const entries = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'promotion'), eq(auditLogs.entityId, promotion.id)))
      .orderBy(auditLogs.createdAt);

    expect(entries.map((entry) => entry.action)).toEqual(['create', 'update', 'delete']);
    expect(entries[1]?.changes).toEqual({ discountValue: [10, 15] });
  });
});
