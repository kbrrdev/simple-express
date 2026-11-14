import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import {
  auditLogs,
  categories,
  paymentMethods,
  products,
  productVariants,
  roles,
  sales,
  SUPER_ADMIN_ROLE_ID,
  users,
} from '../src/db/schema';

const password = 'correct-horse-battery';
const missingId = '00000000-0000-4000-8000-000000000000';
const url = '/api/sales';
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
let otherToken: string;
let addressId: string;
let otherAddressId: string;
let parentId: string;
let shirtsId: string;
let shirtId: string;
let shirt: string;
let capId: string;

async function registerAndLogin(email: string) {
  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

async function createSale(body: object) {
  const response = await api()
    .post(url)
    .set(bearer(adminToken))
    .send({ name: 'Sale', discountType: 'percent', discountValue: 20, ...body })
    .expect(201);
  return response.body.data;
}

async function priceOf(productId: string) {
  const response = await api().get(`/api/products/${productId}`).expect(200);
  return response.body.data.variants[0];
}

async function checkout(
  variantId: string,
  quantity: number,
  expectedTotalCents: number,
  status: number | null = 201,
  user = { token: customerToken, addressId },
) {
  await api()
    .post('/api/cart/items')
    .set(bearer(user.token))
    .send({ variantId, quantity })
    .expect(200);

  const response = await api().post('/api/orders').set(bearer(user.token)).send({
    addressId: user.addressId,
    paymentMethod: 'cod',
    expectedTotalCents,
    idempotencyKey: randomUUID(),
  });

  if (status !== null) expect(response.status).toBe(status);
  return response;
}

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  adminToken = await registerAndLogin('admin@example.com');
  await db
    .update(users)
    .set({ roleId: SUPER_ADMIN_ROLE_ID })
    .where(eq(users.email, 'admin@example.com'));

  // The built-in Admin role, which the migration grants promotions.manage.
  const [adminRole] = await db.select().from(roles).where(eq(roles.name, 'Admin'));
  adminRoleToken = await registerAndLogin('store-admin@example.com');
  await db
    .update(users)
    .set({ roleId: adminRole?.id })
    .where(eq(users.email, 'store-admin@example.com'));

  customerToken = await registerAndLogin('customer@example.com');
  otherToken = await registerAndLogin('other@example.com');
});

beforeEach(async () => {
  await db.execute(
    sql`truncate table sales, categories, products, addresses, orders, payment_methods cascade`,
  );
  await db.execute(sql`truncate table cart_items`);

  const [parent] = await db.insert(categories).values({ name: 'Men' }).returning();
  if (!parent) throw new Error('Failed to insert category');
  parentId = parent.id;

  const [shirts] = await db.insert(categories).values({ name: 'Shirts', parentId }).returning();
  if (!shirts) throw new Error('Failed to insert category');
  shirtsId = shirts.id;

  const [shirtProduct, capProduct] = await db
    .insert(products)
    .values([
      { categoryId: shirtsId, name: 'Classic T-Shirt' },
      { categoryId: parentId, name: 'Cap' },
    ])
    .returning();
  if (!shirtProduct || !capProduct) throw new Error('Failed to insert products');
  shirtId = shirtProduct.id;
  capId = capProduct.id;

  const [shirtVariant, capVariant] = await db
    .insert(productVariants)
    .values([
      { productId: shirtId, priceCents: 100000, stock: 10 },
      { productId: capId, priceCents: 50000, stock: 10 },
    ])
    .returning();
  if (!shirtVariant || !capVariant) throw new Error('Failed to insert variants');
  shirt = shirtVariant.id;

  addressId = (
    await api().post('/api/addresses').set(bearer(customerToken)).send(address).expect(201)
  ).body.data.id;
  otherAddressId = (
    await api().post('/api/addresses').set(bearer(otherToken)).send(address).expect(201)
  ).body.data.id;
});

afterAll(async () => {
  await pool.end();
});

describe('prices', () => {
  it('shows the full price when nothing is on sale', async () => {
    expect(await priceOf(shirtId)).toMatchObject({
      priceCents: 100000,
      compareAtPriceCents: null,
      saleEndsAt: null,
    });
  });

  it('takes a percentage or a fixed amount off', async () => {
    await createSale({ productIds: [shirtId] });
    await createSale({ discountType: 'fixed', discountValue: 15000, productIds: [capId] });

    expect(await priceOf(shirtId)).toMatchObject({
      priceCents: 80000,
      compareAtPriceCents: 100000,
    });
    expect(await priceOf(capId)).toMatchObject({ priceCents: 35000, compareAtPriceCents: 50000 });
  });

  it('never goes below zero', async () => {
    await createSale({ discountType: 'fixed', discountValue: 999999, productIds: [capId] });

    expect((await priceOf(capId)).priceCents).toBe(0);
  });

  it('covers subcategories of a category', async () => {
    await createSale({ categoryIds: [parentId] });

    expect((await priceOf(shirtId)).priceCents).toBe(80000);
    expect((await priceOf(capId)).priceCents).toBe(40000);
  });

  it('gives the lowest price when sales overlap', async () => {
    await createSale({ discountValue: 10, categoryIds: [parentId] });
    await createSale({ discountType: 'fixed', discountValue: 30000, productIds: [shirtId] });
    await createSale({ discountValue: 25, categoryIds: [shirtsId] });

    expect((await priceOf(shirtId)).priceCents).toBe(70000);
  });

  it('only applies active sales within their dates', async () => {
    const now = Date.now();
    await createSale({ productIds: [shirtId], isActive: false });
    await createSale({ productIds: [shirtId], startsAt: new Date(now + hour).toISOString() });
    await createSale({ productIds: [shirtId], endsAt: new Date(now - hour).toISOString() });
    const endsAt = new Date(now + hour).toISOString();
    await createSale({ discountValue: 5, productIds: [capId], endsAt });

    expect((await priceOf(shirtId)).priceCents).toBe(100000);
    expect(await priceOf(capId)).toMatchObject({ priceCents: 47500, saleEndsAt: endsAt });
  });

  it('shows sale prices in lists and carts, and list prices to admins', async () => {
    await createSale({ productIds: [shirtId] });

    const list = await api().get('/api/products').query({ search: 'Classic' }).expect(200);
    expect(list.body.data[0].variants[0].priceCents).toBe(80000);

    const admin = await api()
      .get(`/api/products/admin/${shirtId}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(admin.body.data.variants[0].priceCents).toBe(100000);

    const cart = await api()
      .post('/api/cart/preview')
      .send({ items: [{ variantId: shirt, quantity: 2 }] })
      .expect(200);
    expect(cart.body.data.items[0]).toMatchObject({
      unitPriceCents: 80000,
      compareAtPriceCents: 100000,
      lineTotalCents: 160000,
    });
    expect(cart.body.data.subtotalCents).toBe(160000);
  });
});

describe('listing products on sale', () => {
  const onSale = async (query: object = {}) => {
    const response = await api()
      .get('/api/products')
      .query({ onSale: true, sort: 'name', ...query })
      .expect(200);
    return {
      names: response.body.data.map((product: { name: string }) => product.name),
      total: response.body.meta.total,
    };
  };

  it('is empty when nothing is on sale', async () => {
    expect(await onSale()).toEqual({ names: [], total: 0 });
  });

  it('lists products a sale covers directly or through a category', async () => {
    await createSale({ productIds: [shirtId] });
    expect((await onSale()).names).toEqual(['Classic T-Shirt']);

    await createSale({ categoryIds: [shirtsId] });
    expect((await onSale()).names).toEqual(['Classic T-Shirt']);

    await createSale({ categoryIds: [parentId] });
    expect(await onSale()).toEqual({ names: ['Cap', 'Classic T-Shirt'], total: 2 });
  });

  it('leaves out ended, inactive, and sold out sales', async () => {
    await createSale({ productIds: [shirtId], endsAt: new Date(Date.now() - hour).toISOString() });
    await createSale({ productIds: [shirtId], isActive: false });
    const capped = await createSale({ productIds: [capId], stockCap: 2 });
    await db.update(sales).set({ soldCount: 2 }).where(eq(sales.id, capped.id));

    expect((await onSale()).names).toEqual([]);
  });

  it('combines with search, category, and paging', async () => {
    await createSale({ categoryIds: [parentId] });

    expect((await onSale({ search: 'cap' })).names).toEqual(['Cap']);
    expect((await onSale({ categoryId: shirtsId })).names).toEqual(['Classic T-Shirt']);
    expect(await onSale({ limit: 1 })).toEqual({ names: ['Cap'], total: 2 });
  });

  it('only accepts true', async () => {
    await api().get('/api/products').query({ onSale: false }).expect(400);
  });
});

describe('checkout', () => {
  it('charges the sale price, and keeps the list price on the order', async () => {
    await createSale({ productIds: [shirtId] });

    const preview = await api()
      .post('/api/orders/preview')
      .send({ items: [{ variantId: shirt, quantity: 2 }] })
      .expect(200);
    expect(preview.body.data.totalCents).toBe(160000 + shipping);

    const response = await checkout(shirt, 2, 160000 + shipping, 201);

    expect(response.body.data.items[0]).toMatchObject({
      unitPriceCents: 80000,
      listPriceCents: 100000,
      lineTotalCents: 160000,
    });
  });

  it('refuses the order when a sale ended after the preview', async () => {
    const sale = await createSale({ productIds: [shirtId] });
    await db.update(sales).set({ isActive: false }).where(eq(sales.id, sale.id));

    await checkout(shirt, 1, 80000 + shipping, 409);
  });

  it('reports the discount', async () => {
    await createSale({ productIds: [shirtId] });
    await checkout(shirt, 2, 160000 + shipping, 201);

    const response = await api().get('/api/reports/summary').set(bearer(adminToken)).expect(200);

    expect(response.body.data.discountCents).toBe(40000);
  });
});

describe('stock cap', () => {
  it('sells at the sale price until the cap, then at the full price', async () => {
    const sale = await createSale({ productIds: [shirtId], stockCap: 3 });

    await checkout(shirt, 2, 160000 + shipping, 201);

    // Only one unit is left at the sale price, so buying two pays the full price.
    const preview = await api()
      .post('/api/orders/preview')
      .send({ items: [{ variantId: shirt, quantity: 2 }] })
      .expect(200);
    expect(preview.body.data.items[0].unitPriceCents).toBe(100000);

    await checkout(shirt, 1, 80000 + shipping, 201);

    expect((await priceOf(shirtId)).priceCents).toBe(100000);

    const [row] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(row?.soldCount).toBe(3);
  });

  it('lets only one of two parallel checkouts take the last unit', async () => {
    const sale = await createSale({ productIds: [shirtId], stockCap: 1 });

    const responses = await Promise.all([
      checkout(shirt, 1, 80000 + shipping, null),
      checkout(shirt, 1, 80000 + shipping, null, { token: otherToken, addressId: otherAddressId }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);

    const [row] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(row?.soldCount).toBe(1);
  });

  it('gives an unpaid order a shorter time to pay', async () => {
    await createSale({ productIds: [shirtId], stockCap: 5 });
    const [method] = await db
      .insert(paymentMethods)
      .values({ providerName: 'GCash', accountName: 'Store', accountNumber: '09170000000' })
      .returning();

    await api()
      .post('/api/cart/items')
      .set(bearer(customerToken))
      .send({ variantId: shirt, quantity: 1 })
      .expect(200);
    const order = (
      await api()
        .post('/api/orders')
        .set(bearer(customerToken))
        .send({
          addressId,
          paymentMethod: method?.id,
          expectedTotalCents: 80000 + shipping,
          idempotencyKey: randomUUID(),
        })
        .expect(201)
    ).body.data;
    const hoursToPay = (new Date(order.paymentDueAt).getTime() - Date.now()) / hour;

    expect(hoursToPay).toBeGreaterThan(0.9);
    expect(hoursToPay).toBeLessThanOrEqual(1);
  });

  it('gives units back when an order is cancelled', async () => {
    const sale = await createSale({ productIds: [shirtId], stockCap: 2 });
    const order = (await checkout(shirt, 2, 160000 + shipping, 201)).body.data;

    expect((await priceOf(shirtId)).priceCents).toBe(100000);

    await api().post(`/api/orders/${order.id}/cancel`).set(bearer(customerToken)).expect(200);

    const [row] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(row?.soldCount).toBe(0);
    expect((await priceOf(shirtId)).priceCents).toBe(80000);
  });

  it('cannot be set below the units already sold', async () => {
    const sale = await createSale({ productIds: [shirtId], stockCap: 5 });
    await checkout(shirt, 2, 160000 + shipping, 201);

    await api()
      .patch(`${url}/${sale.id}`)
      .set(bearer(adminToken))
      .send({ stockCap: 1 })
      .expect(409);
  });
});

describe('managing sales', () => {
  it('needs promotions.manage', async () => {
    await api().get(url).expect(401);
    await api().get(url).set(bearer(customerToken)).expect(403);
    await api().get(url).set(bearer(adminRoleToken)).expect(200);
  });

  it('creates, reads, updates, and deletes a sale', async () => {
    const sale = await createSale({ productIds: [shirtId], categoryIds: [parentId] });

    expect(sale).toMatchObject({
      name: 'Sale',
      discountType: 'percent',
      discountValue: 20,
      isActive: true,
      stockCap: null,
      soldCount: 0,
      productIds: [shirtId],
      categoryIds: [parentId],
    });

    const updated = await api()
      .patch(`${url}/${sale.id}`)
      .set(bearer(adminToken))
      .send({ name: 'Payday', categoryIds: [] })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      name: 'Payday',
      productIds: [shirtId],
      categoryIds: [],
    });

    const list = await api().get(url).set(bearer(adminToken)).expect(200);
    expect(list.body.data).toHaveLength(1);

    await api().delete(`${url}/${sale.id}`).set(bearer(adminToken)).expect(204);
    await api().get(`${url}/${sale.id}`).set(bearer(adminToken)).expect(404);
    expect((await priceOf(shirtId)).priceCents).toBe(100000);
  });

  it('keeps past orders when a sale is deleted', async () => {
    const sale = await createSale({ productIds: [shirtId] });
    const order = (await checkout(shirt, 1, 80000 + shipping, 201)).body.data;

    await api().delete(`${url}/${sale.id}`).set(bearer(adminToken)).expect(204);

    const response = await api()
      .get(`/api/orders/${order.id}`)
      .set(bearer(customerToken))
      .expect(200);
    expect(response.body.data.items[0]).toMatchObject({
      unitPriceCents: 80000,
      listPriceCents: 100000,
    });
  });

  it('rejects invalid sales', async () => {
    const send = (body: object) =>
      api()
        .post(url)
        .set(bearer(adminToken))
        .send({ name: 'Sale', discountType: 'percent', discountValue: 20, ...body });

    await send({ productIds: [shirtId], discountValue: 91 }).expect(400);
    await send({}).expect(400);
    await send({ productIds: [missingId] }).expect(400);
    await send({ categoryIds: [missingId] }).expect(400);
    await send({
      productIds: [shirtId],
      startsAt: new Date(Date.now() + hour).toISOString(),
      endsAt: new Date().toISOString(),
    }).expect(400);

    const sale = await createSale({ productIds: [shirtId] });
    await api()
      .patch(`${url}/${sale.id}`)
      .set(bearer(adminToken))
      .send({ productIds: [] })
      .expect(400);
    await api()
      .patch(`${url}/${missingId}`)
      .set(bearer(adminToken))
      .send({ name: 'Gone' })
      .expect(404);
  });

  it('records each change in the audit log', async () => {
    const sale = await createSale({ productIds: [shirtId] });
    await api()
      .patch(`${url}/${sale.id}`)
      .set(bearer(adminToken))
      .send({ discountValue: 30, productIds: [shirtId, capId] })
      .expect(200);
    await api().delete(`${url}/${sale.id}`).set(bearer(adminToken)).expect(204);

    const entries = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'sale'), eq(auditLogs.entityId, sale.id)))
      .orderBy(auditLogs.createdAt);

    expect(entries.map((entry) => entry.action)).toEqual(['create', 'update', 'delete']);
    expect(entries[1]?.changes).toEqual({
      discountValue: [20, 30],
      productIds: [[shirtId], [shirtId, capId]],
    });
  });
});
