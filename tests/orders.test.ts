import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { db, pool } from '../src/db';
import {
  addresses,
  cartItems,
  categories,
  orderItems,
  orders,
  products,
  productVariants,
  SUPER_ADMIN_ROLE_ID,
  users,
} from '../src/db/schema';

const password = 'correct-horse-battery';
const missingId = '00000000-0000-4000-8000-000000000000';

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
let token: string;
let otherToken: string;
let addressId: string;
let otherAddressId: string;
let productId: string;
let medium: string;
let large: string;

async function registerAndLogin(email: string) {
  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

const addToCart = (variantId: string, quantity: number, user = token) =>
  api().post('/api/cart/items').set(bearer(user)).send({ variantId, quantity }).expect(200);

const checkout = (expectedTotalCents: number, overrides: object = {}, user = token) =>
  api()
    .post('/api/orders')
    .set(bearer(user))
    .send({
      addressId,
      paymentMethod: 'cod',
      expectedTotalCents,
      idempotencyKey: randomUUID(),
      ...overrides,
    });

async function placeOrder(quantity = 2) {
  await addToCart(medium, quantity);
  const response = await checkout(112000 * quantity + 10000).expect(201);
  return response.body.data;
}

const setStatus = (id: string, status: string) =>
  api().patch(`/api/orders/admin/${id}/status`).set(bearer(adminToken)).send({ status });

async function stockOf(variantId: string) {
  const [variant] = await db
    .select({ stock: productVariants.stock })
    .from(productVariants)
    .where(eq(productVariants.id, variantId));

  return variant?.stock;
}

const cancel = (id: string, user = token) =>
  api().post(`/api/orders/${id}/cancel`).set(bearer(user));

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  adminToken = await registerAndLogin('admin@example.com');
  await db
    .update(users)
    .set({ roleId: SUPER_ADMIN_ROLE_ID })
    .where(eq(users.email, 'admin@example.com'));
  token = await registerAndLogin('customer@example.com');
  otherToken = await registerAndLogin('other@example.com');
});

beforeEach(async () => {
  await db.execute(sql`truncate table categories, products, addresses, orders cascade`);

  const [category] = await db.insert(categories).values({ name: 'Shirts' }).returning();
  if (!category) throw new Error('Failed to insert category');

  const [product] = await db
    .insert(products)
    .values({ categoryId: category.id, name: 'Classic T-Shirt', option1Name: 'Size' })
    .returning();
  if (!product) throw new Error('Failed to insert product');
  productId = product.id;

  const [first, second] = await db
    .insert(productVariants)
    .values([
      { productId, option1Value: 'M', priceCents: 112000, stock: 10 },
      { productId, option1Value: 'L', priceCents: 56000, stock: 3 },
    ])
    .returning();
  if (!first || !second) throw new Error('Failed to insert variants');
  medium = first.id;
  large = second.id;

  const saved = await api().post('/api/addresses').set(bearer(token)).send(address).expect(201);
  const other = await api()
    .post('/api/addresses')
    .set(bearer(otherToken))
    .send(address)
    .expect(201);
  addressId = saved.body.data.id;
  otherAddressId = other.body.data.id;
});

afterEach(() => {
  env.TAX_RATE_PERCENT = 12;
  env.PRICES_INCLUDE_TAX = true;
  env.SHIPPING_FEE_CENTS = 10000;
});

afterAll(async () => {
  await pool.end();
});

describe('preview', () => {
  const preview = (items: object[]) => api().post('/api/orders/preview').send({ items });

  it('shows tax inside the price, with shipping taxed', async () => {
    const response = await preview([{ variantId: medium, quantity: 1 }]).expect(200);

    expect(response.body.data).toMatchObject({
      subtotalCents: 112000,
      shippingCents: 10000,
      vatableCents: 108929,
      taxCents: 13071,
      totalCents: 122000,
      taxRatePercent: 12,
      pricesIncludeTax: true,
    });
  });

  it('adds tax on top when prices exclude it', async () => {
    env.PRICES_INCLUDE_TAX = false;

    const response = await preview([{ variantId: medium, quantity: 1 }]).expect(200);

    expect(response.body.data).toMatchObject({
      subtotalCents: 112000,
      shippingCents: 10000,
      vatableCents: 122000,
      taxCents: 14640,
      totalCents: 136640,
    });
  });

  it('supports a decimal rate', async () => {
    env.TAX_RATE_PERCENT = 7.5;

    const response = await preview([{ variantId: medium, quantity: 1 }]).expect(200);

    expect(response.body.data.taxRatePercent).toBe(7.5);
    expect(response.body.data.taxCents).toBe(7814 + 698);
  });

  it('charges no tax at a rate of zero', async () => {
    env.TAX_RATE_PERCENT = 0;

    const response = await preview([{ variantId: medium, quantity: 1 }]).expect(200);

    expect(response.body.data).toMatchObject({ taxCents: 0, totalCents: 122000 });
  });

  it('uses the shipping fee setting', async () => {
    env.SHIPPING_FEE_CENTS = 0;

    const response = await preview([{ variantId: medium, quantity: 1 }]).expect(200);

    expect(response.body.data).toMatchObject({ shippingCents: 0, totalCents: 112000 });
  });

  it('shows unavailable items but does not charge for them', async () => {
    await db.update(productVariants).set({ active: false }).where(eq(productVariants.id, large));

    const response = await preview([
      { variantId: medium, quantity: 1 },
      { variantId: large, quantity: 1 },
    ]).expect(200);

    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.subtotalCents).toBe(112000);
  });

  it('charges no shipping when nothing can be bought', async () => {
    const response = await preview([{ variantId: missingId, quantity: 1 }]).expect(200);

    expect(response.body.data).toMatchObject({ shippingCents: 0, totalCents: 0 });
  });

  it('rejects bad input', async () => {
    await preview([{ variantId: medium, quantity: 0 }]).expect(400);
    await api().post('/api/orders/preview').send({}).expect(400);
  });
});

describe('checkout', () => {
  it('requires a token', async () => {
    await api()
      .post('/api/orders')
      .send({
        addressId,
        paymentMethod: 'cod',
        expectedTotalCents: 0,
        idempotencyKey: randomUUID(),
      })
      .expect(401);
  });

  it('creates the order', async () => {
    await addToCart(medium, 1);

    const response = await checkout(122000).expect(201);
    const { data } = response.body;

    expect(response.headers.location).toBe(`/api/orders/${data.id}`);
    expect(data).toMatchObject({
      status: 'pending',
      paymentType: 'cod',
      paymentStatus: 'unpaid',
      subtotalCents: 112000,
      shippingCents: 10000,
      vatableCents: 108929,
      taxCents: 13071,
      totalCents: 122000,
      taxRatePercent: 12,
      pricesIncludeTax: true,
    });
    expect(data.orderNumber).toMatch(/^ORD-\d{6}$/);
    expect(data).not.toHaveProperty('idempotencyKey');
    expect(data.items[0]).toMatchObject({
      variantId: medium,
      productName: 'Classic T-Shirt',
      option1Name: 'Size',
      option1Value: 'M',
      unitPriceCents: 112000,
      listPriceCents: 112000,
      quantity: 1,
      taxCents: 12000,
      lineTotalCents: 112000,
      imageUrl: null,
    });
  });

  it('matches the preview total', async () => {
    await addToCart(medium, 2);
    await addToCart(large, 1);
    const preview = await api()
      .post('/api/orders/preview')
      .send({
        items: [
          { variantId: medium, quantity: 2 },
          { variantId: large, quantity: 1 },
        ],
      })
      .expect(200);

    const response = await checkout(preview.body.data.totalCents).expect(201);

    expect(response.body.data.taxCents).toBe(preview.body.data.taxCents);
  });

  it('adds tax on top when prices exclude it', async () => {
    env.PRICES_INCLUDE_TAX = false;
    await addToCart(medium, 1);

    const response = await checkout(136640).expect(201);

    expect(response.body.data).toMatchObject({ pricesIncludeTax: false, totalCents: 136640 });
  });

  it('reduces stock and empties the cart', async () => {
    await placeOrder(2);

    expect(await stockOf(medium)).toBe(8);
    expect(await db.select().from(cartItems)).toEqual([]);
  });

  it('gives each order a higher number', async () => {
    const first = await placeOrder(1);
    const second = await placeOrder(1);

    expect(second.orderNumber > first.orderNumber).toBe(true);
  });

  it('rejects an empty cart', async () => {
    const response = await checkout(0).expect(409);

    expect(response.body.error.message).toBe('Cart is empty');
  });

  it("rejects another user's address", async () => {
    await addToCart(medium, 1);

    await checkout(122000, { addressId: otherAddressId }).expect(404);

    expect(await stockOf(medium)).toBe(10);
  });

  it('rejects a changed total, and changes nothing', async () => {
    await addToCart(medium, 1);
    await db
      .update(productVariants)
      .set({ priceCents: 50000 })
      .where(eq(productVariants.id, medium));

    const response = await checkout(122000).expect(409);

    expect(response.body.error.message).toBe('The order total has changed');
    expect(await stockOf(medium)).toBe(10);
    expect(await db.select().from(orders)).toEqual([]);
    expect(await db.select().from(cartItems)).toHaveLength(1);
  });

  it('takes prices from the database, not the request', async () => {
    await addToCart(medium, 1);

    await checkout(1).expect(409);
    await checkout(122000, { subtotalCents: 1 }).expect(400);
    await checkout(122000, { items: [{ unitPriceCents: 1 }] }).expect(400);
    await checkout(122000, { status: 'delivered' }).expect(400);
    await checkout(122000, { paymentStatus: 'paid' }).expect(400);
  });

  it('rejects a bad payment method', async () => {
    await addToCart(medium, 1);

    await checkout(122000, { paymentMethod: 'free' }).expect(400);
    await checkout(122000, { paymentMethod: 'gcash' }).expect(400);
  });

  it('rejects a bad body', async () => {
    await checkout(-1).expect(400);
    await checkout(1.5).expect(400);
    await checkout(1, { idempotencyKey: 'nope' }).expect(400);
    await checkout(1, { addressId: 'nope' }).expect(400);
  });

  it('rejects an unavailable item and names it', async () => {
    await addToCart(medium, 1);
    await db.update(productVariants).set({ active: false }).where(eq(productVariants.id, medium));

    const response = await checkout(122000).expect(409);

    expect(response.body.error.details).toEqual([
      { field: medium, message: 'Classic T-Shirt is unavailable' },
    ]);
    expect(await db.select().from(orders)).toEqual([]);
  });

  it('rejects an item from a deactivated product', async () => {
    await addToCart(medium, 1);
    await db.update(products).set({ active: false }).where(eq(products.id, productId));

    await checkout(122000).expect(409);
  });

  it('rejects an item short of stock and names it', async () => {
    await addToCart(large, 3);
    await db.update(productVariants).set({ stock: 2 }).where(eq(productVariants.id, large));

    const response = await checkout(178000).expect(409);

    expect(response.body.error.details).toEqual([
      { field: large, message: 'Classic T-Shirt does not have enough stock' },
    ]);
  });

  it('changes nothing when only some items have enough stock', async () => {
    await addToCart(medium, 2);
    await addToCart(large, 3);
    await db.update(productVariants).set({ stock: 2 }).where(eq(productVariants.id, large));

    await checkout(402000).expect(409);

    expect(await stockOf(medium)).toBe(10);
    expect(await stockOf(large)).toBe(2);
    expect(await db.select().from(orders)).toEqual([]);
    expect(await db.select().from(orderItems)).toEqual([]);
    expect(await db.select().from(cartItems)).toHaveLength(2);
  });
});

describe('very large orders', () => {
  it('handles totals beyond a 32-bit integer', async () => {
    await db
      .update(productVariants)
      .set({ priceCents: 2000000000, stock: 200 })
      .where(eq(productVariants.id, medium));
    await addToCart(medium, 99);

    const response = await checkout(198000010000).expect(201);

    expect(response.body.data).toMatchObject({
      subtotalCents: 198000000000,
      totalCents: 198000010000,
    });

    const saved = await api()
      .get(`/api/orders/${response.body.data.id}`)
      .set(bearer(token))
      .expect(200);

    expect(saved.body.data.items[0].lineTotalCents).toBe(198000000000);
  });
});

describe('open unpaid orders', () => {
  afterEach(() => {
    env.MAX_OPEN_UNPAID_ORDERS = 1000;
  });

  it('stops a customer holding too many, keeping the cart', async () => {
    env.MAX_OPEN_UNPAID_ORDERS = 2;
    await placeOrder(1);
    await placeOrder(1);
    await addToCart(medium, 1);

    const response = await checkout(122000).expect(409);

    expect(response.body.error.message).toBe(
      'Pay or cancel your open orders before placing another',
    );
    expect(await stockOf(medium)).toBe(8);
    expect(await db.select().from(cartItems)).toHaveLength(1);
  });

  it('frees a slot when an order is cancelled or moves on', async () => {
    env.MAX_OPEN_UNPAID_ORDERS = 2;
    const first = await placeOrder(1);
    const second = await placeOrder(1);

    await cancel(first.id).expect(200);
    await setStatus(second.id, 'confirmed').expect(200);

    await placeOrder(1);
    await placeOrder(1);
  });

  it('does not affect other customers', async () => {
    env.MAX_OPEN_UNPAID_ORDERS = 1;
    await placeOrder(1);
    await addToCart(medium, 1, otherToken);

    await checkout(122000, { addressId: otherAddressId }, otherToken).expect(201);
  });

  it('still returns the original order to a retry', async () => {
    env.MAX_OPEN_UNPAID_ORDERS = 1;
    await addToCart(medium, 1);
    const idempotencyKey = randomUUID();

    const first = await checkout(122000, { idempotencyKey }).expect(201);
    const retry = await checkout(122000, { idempotencyKey }).expect(200);

    expect(retry.body.data.id).toBe(first.body.data.id);
  });

  it('cannot be passed with parallel requests', async () => {
    env.MAX_OPEN_UNPAID_ORDERS = 1;
    await placeOrder(1);
    await addToCart(medium, 1);

    const responses = await Promise.all(Array.from({ length: 6 }, () => checkout(122000)));

    expect(responses.every(({ status }) => status === 409)).toBe(true);
    expect(await db.select().from(orders)).toHaveLength(1);
  });
});

describe('repeated checkouts', () => {
  it('returns the original order for a repeated key', async () => {
    await addToCart(medium, 1);
    const idempotencyKey = randomUUID();

    const first = await checkout(122000, { idempotencyKey }).expect(201);
    const second = await checkout(122000, { idempotencyKey }).expect(200);

    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.items).toHaveLength(1);
    expect(await stockOf(medium)).toBe(9);
  });

  it('lets another user use the same key', async () => {
    const idempotencyKey = randomUUID();
    await addToCart(medium, 1);
    await addToCart(medium, 1, otherToken);

    await checkout(122000, { idempotencyKey }).expect(201);
    await checkout(122000, { idempotencyKey, addressId: otherAddressId }, otherToken).expect(201);

    expect(await db.select().from(orders)).toHaveLength(2);
  });

  it('creates one order from parallel requests with the same key', async () => {
    await addToCart(medium, 1);
    const idempotencyKey = randomUUID();

    const responses = await Promise.all(
      Array.from({ length: 15 }, () => checkout(122000, { idempotencyKey })),
    );

    expect(responses.filter(({ status }) => status === 201)).toHaveLength(1);
    expect(responses.filter(({ status }) => status === 200)).toHaveLength(14);
    expect(await db.select().from(orders)).toHaveLength(1);
    expect(await stockOf(medium)).toBe(9);
  });

  it('cannot buy one cart twice with parallel requests and different keys', async () => {
    await addToCart(medium, 1);

    const responses = await Promise.all(Array.from({ length: 15 }, () => checkout(122000)));

    expect(responses.filter(({ status }) => status === 201)).toHaveLength(1);
    expect(responses.filter(({ status }) => status === 409)).toHaveLength(14);
    expect(await stockOf(medium)).toBe(9);
  });
});

describe('the last item', () => {
  it('goes to exactly one of two buyers', async () => {
    await db.update(productVariants).set({ stock: 1 }).where(eq(productVariants.id, large));
    await addToCart(large, 1);
    await addToCart(large, 1, otherToken);

    const responses = await Promise.all([
      checkout(66000),
      checkout(66000, { addressId: otherAddressId }, otherToken),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(await stockOf(large)).toBe(0);
    expect(await db.select().from(orders)).toHaveLength(1);
  });

  it('does not deadlock when carts hold the same items in opposite orders', async () => {
    await db.update(productVariants).set({ stock: 1000 });

    for (let round = 0; round < 15; round++) {
      await addToCart(medium, 1);
      await addToCart(large, 1);
      await addToCart(large, 1, otherToken);
      await addToCart(medium, 1, otherToken);

      const responses = await Promise.all([
        checkout(178000),
        checkout(178000, { addressId: otherAddressId }, otherToken),
      ]);

      expect(responses.map(({ status }) => status)).toEqual([201, 201]);
    }

    expect(await stockOf(medium)).toBe(970);
    expect(await stockOf(large)).toBe(970);
  });

  it('never oversells across many items in opposite cart orders', async () => {
    await addToCart(medium, 1);
    await addToCart(large, 1);
    await addToCart(large, 1, otherToken);
    await addToCart(medium, 1, otherToken);

    const responses = await Promise.all([
      checkout(178000),
      checkout(178000, { addressId: otherAddressId }, otherToken),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(await stockOf(medium)).toBe(8);
    expect(await stockOf(large)).toBe(1);
  });
});

describe('order history', () => {
  it('lists only your orders, newest first', async () => {
    const first = await placeOrder(1);
    const second = await placeOrder(1);
    await addToCart(medium, 1, otherToken);
    await checkout(122000, { addressId: otherAddressId }, otherToken).expect(201);

    const response = await api().get('/api/orders').set(bearer(token)).expect(200);

    expect(response.body.meta).toEqual({ page: 1, limit: 20, total: 2 });
    expect(response.body.data.map((order: { id: string }) => order.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(response.body.data[0].items).toHaveLength(1);
  });

  it('paginates and filters by status', async () => {
    const first = await placeOrder(1);
    await placeOrder(1);
    await cancel(first.id).expect(200);

    const page = await api().get('/api/orders?limit=1&page=2').set(bearer(token)).expect(200);
    const filtered = await api().get('/api/orders?status=cancelled').set(bearer(token)).expect(200);

    expect(page.body.data).toHaveLength(1);
    expect(filtered.body.meta.total).toBe(1);
    expect(filtered.body.data[0].id).toBe(first.id);
  });

  it('rejects a bad status filter', async () => {
    await api().get('/api/orders?status=nope').set(bearer(token)).expect(400);
  });

  it('requires a token', async () => {
    const order = await placeOrder(1);

    await api().get('/api/orders').expect(401);
    await api().get(`/api/orders/${order.id}`).expect(401);
    await api().post(`/api/orders/${order.id}/cancel`).expect(401);
  });

  it('gets your own order', async () => {
    const order = await placeOrder(1);

    const response = await api().get(`/api/orders/${order.id}`).set(bearer(token)).expect(200);

    expect(response.body.data.shippingAddress).toEqual({
      ...address,
      phone: '+639171234567',
      line2: '',
    });
  });

  it("hides another user's order behind a 404", async () => {
    const order = await placeOrder(1);

    await api().get(`/api/orders/${order.id}`).set(bearer(otherToken)).expect(404);
    await cancel(order.id, otherToken).expect(404);

    expect(await stockOf(medium)).toBe(9);
  });

  it('returns 404 for a missing order and 400 for a bad id', async () => {
    await api().get(`/api/orders/${missingId}`).set(bearer(token)).expect(404);
    await api().get('/api/orders/nope').set(bearer(token)).expect(400);
  });
});

describe('past orders', () => {
  it('keep their details when the catalog and address change', async () => {
    const order = await placeOrder(1);

    await db.update(products).set({ name: 'Renamed', active: false });
    await db
      .update(productVariants)
      .set({ priceCents: 1, option1Value: 'XXL' })
      .where(eq(productVariants.id, medium));
    await db.update(addresses).set({ city: 'Taguig' });

    const response = await api().get(`/api/orders/${order.id}`).set(bearer(token)).expect(200);
    const { data } = response.body;

    expect(data.items[0]).toMatchObject({
      productName: 'Classic T-Shirt',
      option1Value: 'M',
      unitPriceCents: 112000,
    });
    expect(data.shippingAddress.city).toBe('Pasig');
  });

  it('survive deleting the address', async () => {
    const order = await placeOrder(1);

    await api().delete(`/api/addresses/${addressId}`).set(bearer(token)).expect(204);

    await api().get(`/api/orders/${order.id}`).set(bearer(token)).expect(200);
  });

  it('keep their tax rate and shipping fee when settings change', async () => {
    const order = await placeOrder(1);

    env.TAX_RATE_PERCENT = 5;
    env.SHIPPING_FEE_CENTS = 99900;

    const response = await api().get(`/api/orders/${order.id}`).set(bearer(token)).expect(200);

    expect(response.body.data).toMatchObject({
      taxRatePercent: 12,
      shippingCents: 10000,
      totalCents: 122000,
    });
  });

  it('block deleting the variant they refer to', async () => {
    await placeOrder(1);

    await expect(db.delete(productVariants)).rejects.toThrow();
  });
});

describe('cancelling', () => {
  it('cancels a pending order and returns stock', async () => {
    const order = await placeOrder(2);

    const response = await cancel(order.id).expect(200);

    expect(response.body.data.status).toBe('cancelled');
    expect(await stockOf(medium)).toBe(10);
  });

  it('returns stock once when repeated', async () => {
    const order = await placeOrder(2);

    await cancel(order.id).expect(200);
    await cancel(order.id).expect(409);

    expect(await stockOf(medium)).toBe(10);
  });

  it('returns stock once with parallel requests', async () => {
    const order = await placeOrder(2);

    const responses = await Promise.all(Array.from({ length: 12 }, () => cancel(order.id)));

    expect(responses.filter(({ status }) => status === 200)).toHaveLength(1);
    expect(await stockOf(medium)).toBe(10);
  });

  it('returns stock once when a customer and admin cancel together', async () => {
    const order = await placeOrder(2);

    await Promise.all([cancel(order.id), setStatus(order.id, 'cancelled')]);

    expect(await stockOf(medium)).toBe(10);
  });

  it('is not allowed for customers after confirmation', async () => {
    const order = await placeOrder(1);
    await setStatus(order.id, 'confirmed').expect(200);

    const response = await cancel(order.id).expect(409);

    expect(response.body.error.message).toBe('This order can no longer be cancelled');
    expect(await stockOf(medium)).toBe(9);
  });

  it('returns stock for several items', async () => {
    await addToCart(medium, 2);
    await addToCart(large, 3);
    const order = (await checkout(402000).expect(201)).body.data;

    await cancel(order.id).expect(200);

    expect(await stockOf(medium)).toBe(10);
    expect(await stockOf(large)).toBe(3);
  });
});

describe('admin orders', () => {
  it('only allows admins', async () => {
    const order = await placeOrder(1);

    await api().get('/api/orders/admin').expect(401);
    await api().get('/api/orders/admin').set(bearer(token)).expect(403);
    await api().get(`/api/orders/admin/${order.id}`).set(bearer(token)).expect(403);
    await api()
      .patch(`/api/orders/admin/${order.id}/status`)
      .set(bearer(token))
      .send({ status: 'delivered' })
      .expect(403);
  });

  it('lists every order with the customer', async () => {
    await placeOrder(1);
    await addToCart(medium, 1, otherToken);
    await checkout(122000, { addressId: otherAddressId }, otherToken).expect(201);

    const response = await api().get('/api/orders/admin').set(bearer(adminToken)).expect(200);

    expect(response.body.meta.total).toBe(2);
    expect(
      response.body.data.map((order: { customerEmail: string }) => order.customerEmail).sort(),
    ).toEqual(['customer@example.com', 'other@example.com']);
  });

  it('filters by status', async () => {
    const order = await placeOrder(1);
    await placeOrder(1);
    await setStatus(order.id, 'confirmed').expect(200);

    const response = await api()
      .get('/api/orders/admin?status=confirmed')
      .set(bearer(adminToken))
      .expect(200);

    expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([order.id]);
  });

  it('gets any order', async () => {
    const order = await placeOrder(1);

    const response = await api()
      .get(`/api/orders/admin/${order.id}`)
      .set(bearer(adminToken))
      .expect(200);

    expect(response.body.data.customerEmail).toBe('customer@example.com');
    await api().get(`/api/orders/admin/${missingId}`).set(bearer(adminToken)).expect(404);
  });

  it('keeps orders when the user is deleted', async () => {
    const order = await placeOrder(1);
    await db.delete(users).where(eq(users.email, 'customer@example.com'));

    const response = await api()
      .get(`/api/orders/admin/${order.id}`)
      .set(bearer(adminToken))
      .expect(200);

    expect(response.body.data).toMatchObject({ userId: null, customerEmail: null });

    token = await registerAndLogin('customer@example.com');
  });

  it('rejects a bad status and a missing order', async () => {
    const order = await placeOrder(1);

    await setStatus(order.id, 'pending').expect(400);
    await setStatus(order.id, 'nope').expect(400);
    await setStatus(missingId, 'confirmed').expect(404);
  });
});

describe('status changes', () => {
  const walk = async (order: { id: string }, steps: string[]) => {
    for (const step of steps) {
      await setStatus(order.id, step).expect(200);
    }
  };

  it('walks an order through to delivery', async () => {
    const order = await placeOrder(1);

    await walk(order, ['confirmed', 'shipped']);
    const response = await setStatus(order.id, 'delivered').expect(200);

    expect(response.body.data.status).toBe('delivered');
  });

  it.each([
    ['pending', [], 'shipped'],
    ['pending', [], 'delivered'],
    ['pending', [], 'returned'],
    ['confirmed', ['confirmed'], 'confirmed'],
    ['confirmed', ['confirmed'], 'delivered'],
    ['confirmed', ['confirmed'], 'returned'],
    ['shipped', ['confirmed', 'shipped'], 'confirmed'],
    ['shipped', ['confirmed', 'shipped'], 'cancelled'],
    ['delivered', ['confirmed', 'shipped', 'delivered'], 'returned'],
    ['delivered', ['confirmed', 'shipped', 'delivered'], 'cancelled'],
    ['delivered', ['confirmed', 'shipped', 'delivered'], 'shipped'],
    ['returned', ['confirmed', 'shipped', 'returned'], 'delivered'],
    ['returned', ['confirmed', 'shipped', 'returned'], 'cancelled'],
    ['cancelled', ['cancelled'], 'confirmed'],
    ['cancelled', ['cancelled'], 'cancelled'],
  ])('rejects moving from %s using %j to %s', async (_from, steps, next) => {
    const order = await placeOrder(1);
    await walk(order, steps);
    const stock = await stockOf(medium);

    await setStatus(order.id, next).expect(409);

    expect(await stockOf(medium)).toBe(stock);
  });

  it('lets an admin cancel a confirmed order, returning stock', async () => {
    const order = await placeOrder(2);
    await walk(order, ['confirmed']);

    const response = await setStatus(order.id, 'cancelled').expect(200);

    expect(response.body.data.status).toBe('cancelled');
    expect(await stockOf(medium)).toBe(10);
  });

  it('applies one change when two arrive together', async () => {
    const order = await placeOrder(2);
    await walk(order, ['confirmed']);

    const responses = await Promise.all([
      setStatus(order.id, 'cancelled'),
      setStatus(order.id, 'shipped'),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
  });
});

describe('COD payment', () => {
  it('stays unpaid until delivery', async () => {
    const order = await placeOrder(1);

    const confirmed = await setStatus(order.id, 'confirmed').expect(200);
    const shipped = await setStatus(order.id, 'shipped').expect(200);

    expect(confirmed.body.data.paymentStatus).toBe('unpaid');
    expect(shipped.body.data.paymentStatus).toBe('unpaid');
  });

  it('becomes paid on delivery', async () => {
    const order = await placeOrder(1);
    await setStatus(order.id, 'confirmed').expect(200);
    await setStatus(order.id, 'shipped').expect(200);

    const response = await setStatus(order.id, 'delivered').expect(200);
    const [saved] = await db
      .select({ paidAt: orders.paidAt })
      .from(orders)
      .where(eq(orders.id, order.id));

    expect(response.body.data.paymentStatus).toBe('paid');
    expect(saved?.paidAt).toBeInstanceOf(Date);
  });

  it('stays unpaid when cancelled', async () => {
    const order = await placeOrder(1);

    const response = await setStatus(order.id, 'cancelled').expect(200);

    expect(response.body.data.paymentStatus).toBe('unpaid');
  });
});

describe('returned orders', () => {
  it('do not return stock and stay unpaid', async () => {
    const order = await placeOrder(2);
    await setStatus(order.id, 'confirmed').expect(200);
    await setStatus(order.id, 'shipped').expect(200);

    const response = await setStatus(order.id, 'returned').expect(200);

    expect(response.body.data).toMatchObject({ status: 'returned', paymentStatus: 'unpaid' });
    expect(await stockOf(medium)).toBe(8);
  });

  it('can have stock added back by hand', async () => {
    const order = await placeOrder(2);
    await setStatus(order.id, 'confirmed').expect(200);
    await setStatus(order.id, 'shipped').expect(200);
    await setStatus(order.id, 'returned').expect(200);

    await api()
      .patch(`/api/products/${productId}/variants/${medium}`)
      .set(bearer(adminToken))
      .send({ stock: 10 })
      .expect(200);

    expect(await stockOf(medium)).toBe(10);
  });
});

describe('images on orders', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
  ]);

  const upload = async () => {
    const response = await api()
      .post('/api/assets')
      .set(bearer(adminToken))
      .attach('file', png, 'photo.png')
      .expect(201);

    return response.body.data as { id: string; url: string };
  };

  const addImage = (assetId: string) =>
    api()
      .post(`/api/products/${productId}/images`)
      .set(bearer(adminToken))
      .send({ assetId })
      .expect(201);

  it("uses the product's first image", async () => {
    const asset = await upload();
    await addImage(asset.id);

    const order = await placeOrder(1);

    expect(order.items[0].imageUrl).toBe(asset.url);
  });

  it("prefers the variant's image", async () => {
    await addImage((await upload()).id);
    const second = await upload();
    await addImage(second.id);
    await api()
      .patch(`/api/products/${productId}/variants/${medium}`)
      .set(bearer(adminToken))
      .send({ assetId: second.id })
      .expect(200);

    const order = await placeOrder(1);

    expect(order.items[0].imageUrl).toBe(second.url);
  });

  it('block deleting the asset, even after it leaves the product', async () => {
    const asset = await upload();
    const image = (await addImage(asset.id)).body.data;
    await placeOrder(1);

    await api()
      .delete(`/api/products/${productId}/images/${image.id}`)
      .set(bearer(adminToken))
      .expect(204);

    await api().delete(`/api/assets/${asset.id}`).set(bearer(adminToken)).expect(409);
  });
});
