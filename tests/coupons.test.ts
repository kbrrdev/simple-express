import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { db, pool } from '../src/db';
import {
  auditLogs,
  categories,
  couponRedemptions,
  paymentMethods,
  products,
  productVariants,
  roles,
  sales,
  SUPER_ADMIN_ROLE_ID,
  users,
} from '../src/db/schema';
import { spread } from '../src/modules/coupons/coupon.service';
import { couponLimiter, guestOrderLimiter } from '../src/modules/orders/order.routes';

const password = 'correct-horse-battery';
const missingId = '00000000-0000-4000-8000-000000000000';
const url = '/api/coupons';
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
let customer: { token: string; addressId: string };
let other: { token: string; addressId: string };
let shirtId: string;
let shirt: string;
let cap: string;
let methodId: string;

async function registerAndLogin(email: string) {
  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

async function createCoupon(body: object) {
  const response = await api()
    .post(url)
    .set(bearer(adminToken))
    .send({ code: 'SAVE10', discountType: 'percent', discountValue: 10, ...body })
    .expect(201);
  return response.body.data;
}

const preview = (items: object[], body: object = {}, token?: string) => {
  const call = api().post('/api/orders/preview');
  if (token) call.set(bearer(token));
  return call.send({ items, ...body }).expect(200);
};

async function checkout(
  items: { variantId: string; quantity: number }[],
  expectedTotalCents: number,
  couponCode: string | undefined,
  status: number | null = 201,
  user = customer,
) {
  for (const item of items) {
    await api().post('/api/cart/items').set(bearer(user.token)).send(item).expect(200);
  }

  const response = await api().post('/api/orders').set(bearer(user.token)).send({
    addressId: user.addressId,
    paymentMethod: 'cod',
    expectedTotalCents,
    idempotencyKey: randomUUID(),
    couponCode,
  });

  if (status !== null) expect(response.status).toBe(status);
  return response;
}

const guestCheckout = (email: string, expectedTotalCents: number, couponCode: string) =>
  api()
    .post('/api/orders/guest')
    .send({
      email,
      address,
      items: [{ variantId: shirt, quantity: 1 }],
      paymentMethod: methodId,
      expectedTotalCents,
      idempotencyKey: randomUUID(),
      couponCode,
    });

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

  customer = { token: await registerAndLogin('customer@example.com'), addressId: '' };
  other = { token: await registerAndLogin('other@example.com'), addressId: '' };
});

beforeEach(async () => {
  await db.execute(
    sql`truncate table coupons, sales, categories, products, addresses, orders, payment_methods cascade`,
  );
  await db.execute(sql`truncate table cart_items`);

  for (const key of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
    await guestOrderLimiter.resetKey(key);
    await couponLimiter.resetKey(key);
  }

  const [category] = await db.insert(categories).values({ name: 'Shirts' }).returning();
  if (!category) throw new Error('Failed to insert category');

  const [shirtProduct, capProduct] = await db
    .insert(products)
    .values([
      { categoryId: category.id, name: 'Classic T-Shirt' },
      { categoryId: category.id, name: 'Cap' },
    ])
    .returning();
  if (!shirtProduct || !capProduct) throw new Error('Failed to insert products');
  shirtId = shirtProduct.id;

  const [shirtVariant, capVariant] = await db
    .insert(productVariants)
    .values([
      { productId: shirtProduct.id, priceCents: 100000, stock: 50 },
      { productId: capProduct.id, priceCents: 50000, stock: 50 },
    ])
    .returning();
  if (!shirtVariant || !capVariant) throw new Error('Failed to insert variants');
  shirt = shirtVariant.id;
  cap = capVariant.id;

  const [method] = await db
    .insert(paymentMethods)
    .values({ providerName: 'GCash', accountName: 'Store', accountNumber: '09170000000' })
    .returning();
  methodId = method?.id ?? '';

  for (const user of [customer, other]) {
    user.addressId = (
      await api().post('/api/addresses').set(bearer(user.token)).send(address).expect(201)
    ).body.data.id;
  }
});

afterEach(() => {
  env.FREE_SHIPPING_MIN_CENTS = undefined;
});

afterAll(async () => {
  await pool.end();
});

describe('pricing', () => {
  it('takes a percentage off, in any letter case', async () => {
    await createCoupon({});

    const response = await preview([{ variantId: shirt, quantity: 2 }], { couponCode: 'save10' });

    expect(response.body.data).toMatchObject({
      subtotalCents: 200000,
      discountCents: 20000,
      shippingCents: shipping,
      totalCents: 200000 - 20000 + shipping,
      coupon: { code: 'SAVE10', discountCents: 20000, freeShipping: false },
      couponError: null,
    });
  });

  it('caps a percentage at maxDiscountCents', async () => {
    await createCoupon({ discountValue: 50, maxDiscountCents: 30000 });

    const response = await preview([{ variantId: shirt, quantity: 1 }], { couponCode: 'SAVE10' });

    expect(response.body.data.discountCents).toBe(30000);
  });

  it('takes a fixed amount off, never more than the eligible items', async () => {
    await createCoupon({ code: 'LESS150', discountType: 'fixed', discountValue: 15000 });
    await createCoupon({ code: 'HUGE', discountType: 'fixed', discountValue: 9999999 });

    const fixed = await preview([{ variantId: cap, quantity: 1 }], { couponCode: 'LESS150' });
    const huge = await preview([{ variantId: cap, quantity: 1 }], { couponCode: 'HUGE' });

    expect(fixed.body.data.totalCents).toBe(50000 - 15000 + shipping);
    expect(huge.body.data).toMatchObject({ discountCents: 50000, totalCents: shipping });
  });

  it('waives shipping', async () => {
    await createCoupon({ code: 'FREESHIP', discountType: 'free_shipping', discountValue: 500 });

    const response = await preview([{ variantId: cap, quantity: 1 }], { couponCode: 'FREESHIP' });

    expect(response.body.data).toMatchObject({
      discountCents: 0,
      shippingCents: 0,
      totalCents: 50000,
      coupon: { code: 'FREESHIP', discountCents: 0, freeShipping: true },
    });
  });

  it('leaves out items on sale unless the coupon allows them', async () => {
    const [sale] = await db
      .insert(sales)
      .values({ name: 'Sale', discountType: 'percent', discountValue: 20 })
      .returning();
    await db.execute(sql`insert into sale_products values (${sale?.id}, ${shirtId})`);
    await createCoupon({});
    await createCoupon({ code: 'ANY10', allowSaleItems: true });

    const items = [
      { variantId: shirt, quantity: 1 },
      { variantId: cap, quantity: 1 },
    ];
    const excluded = await preview(items, { couponCode: 'SAVE10' });
    const allowed = await preview(items, { couponCode: 'ANY10' });
    const onlySale = await preview([{ variantId: shirt, quantity: 1 }], { couponCode: 'SAVE10' });

    expect(excluded.body.data.discountCents).toBe(5000);
    expect(allowed.body.data.discountCents).toBe(13000);
    expect(onlySale.body.data).toMatchObject({
      coupon: null,
      couponError: 'This coupon cannot be used on items on sale',
    });
  });

  it('splits the discount across lines without losing a cent', () => {
    const lines = (...totals: number[]) =>
      totals.map((lineTotalCents, index) => ({
        variantId: String(index),
        lineTotalCents,
        onSale: false,
      }));

    expect([...spread(100, lines(300, 300, 400)).values()]).toEqual([30, 30, 40]);
    expect([...spread(7, lines(10, 10, 10)).values()]).toEqual([3, 2, 2]);
    expect([...spread(3, lines(1, 1, 1)).values()]).toEqual([1, 1, 1]);
    expect([...spread(0, lines(5)).values()]).toEqual([0]);
  });
});

describe('checks', () => {
  const couponError = async (body: object, items = [{ variantId: shirt, quantity: 1 }]) =>
    (await preview(items, { couponCode: 'SAVE10', ...body })).body.data.couponError;

  it('explains why a coupon cannot be used, and prices without it', async () => {
    expect(await couponError({ couponCode: 'NOPE' })).toBe('This coupon is not valid');

    await createCoupon({ isActive: false });
    expect(await couponError({})).toBe('This coupon is not valid');

    await createCoupon({ code: 'LATER', startsAt: new Date(Date.now() + hour).toISOString() });
    expect(await couponError({ couponCode: 'LATER' })).toBe('This coupon is not active yet');

    await createCoupon({ code: 'OLD', endsAt: new Date(Date.now() - hour).toISOString() });
    expect(await couponError({ couponCode: 'OLD' })).toBe('This coupon has expired');

    await createCoupon({ code: 'BIG', minSubtotalCents: 150000 });
    expect(await couponError({ couponCode: 'BIG' })).toBe(
      'Spend ₱500.00 more on eligible items to use this coupon',
    );

    const response = await preview([{ variantId: shirt, quantity: 1 }], { couponCode: 'BIG' });
    expect(response.body.data).toMatchObject({
      coupon: null,
      discountCents: 0,
      totalCents: 100000 + shipping,
    });
  });

  it('refuses checkout with the reason', async () => {
    await createCoupon({ endsAt: new Date(Date.now() - hour).toISOString() });

    const response = await checkout(
      [{ variantId: shirt, quantity: 1 }],
      100000 + shipping,
      'SAVE10',
      409,
    );

    expect(response.body.error.message).toBe('This coupon has expired');
  });
});

describe('checkout', () => {
  it('saves the coupon, the discount, and each line’s share', async () => {
    await createCoupon({ code: 'LESS100', discountType: 'fixed', discountValue: 10000 });

    const response = await checkout(
      [
        { variantId: shirt, quantity: 1 },
        { variantId: cap, quantity: 2 },
      ],
      200000 - 10000 + shipping,
      'less100',
    );
    const order = response.body.data;

    expect(order).toMatchObject({
      couponCode: 'LESS100',
      subtotalCents: 200000,
      discountCents: 10000,
      totalCents: 200000 - 10000 + shipping,
    });

    const shirtLine = order.items.find((item: { variantId: string }) => item.variantId === shirt);
    const capLine = order.items.find((item: { variantId: string }) => item.variantId === cap);
    expect(shirtLine).toMatchObject({ discountCents: 5000, lineTotalCents: 95000 });
    expect(capLine).toMatchObject({ discountCents: 5000, lineTotalCents: 95000 });
    // Tax follows the discounted line, at 12% inside the price.
    expect(shirtLine.taxCents).toBe(Math.round((95000 * 1200) / 11200));

    const list = await api().get(url).set(bearer(adminToken)).expect(200);
    expect(list.body.data[0]).toMatchObject({ usedCount: 1, discountGivenCents: 10000 });

    const report = await api().get('/api/reports/summary').set(bearer(adminToken)).expect(200);
    expect(report.body.data).toMatchObject({ couponDiscountCents: 10000, discountCents: 10000 });
  });

  it('counts waived shipping as what the shopper saved', async () => {
    await createCoupon({ code: 'FREESHIP', discountType: 'free_shipping' });

    await checkout([{ variantId: cap, quantity: 1 }], 50000, 'FREESHIP');

    const [redemption] = await db.select().from(couponRedemptions);
    expect(redemption?.discountCents).toBe(shipping);
  });
});

describe('limits', () => {
  const total = 100000 - 10000 + shipping;

  it('allows one use per customer by default, and gives it back on cancel', async () => {
    await createCoupon({});
    const first = (await checkout([{ variantId: shirt, quantity: 1 }], total, 'SAVE10')).body.data;

    const again = await checkout([{ variantId: shirt, quantity: 1 }], total, 'SAVE10', 409);
    expect(again.body.error.message).toBe('You have already used this coupon');

    const asCustomer = await preview(
      [{ variantId: shirt, quantity: 1 }],
      { couponCode: 'SAVE10' },
      customer.token,
    );
    expect(asCustomer.body.data.couponError).toBe('You have already used this coupon');

    await checkout([{ variantId: shirt, quantity: 1 }], total, 'SAVE10', 201, other);

    await api().post(`/api/orders/${first.id}/cancel`).set(bearer(customer.token)).expect(200);
    await api().delete(`/api/cart/items/${shirt}`).set(bearer(customer.token));
    await checkout([{ variantId: shirt, quantity: 1 }], total, 'SAVE10');
  });

  it('lets only one of two parallel checkouts take the last use', async () => {
    await createCoupon({ usageLimit: 1 });

    const responses = await Promise.all([
      checkout([{ variantId: shirt, quantity: 1 }], total, 'SAVE10', null),
      checkout([{ variantId: shirt, quantity: 1 }], total, 'SAVE10', null, other),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const refused = responses.find((response) => response.status === 409);
    expect(refused?.body.error.message).toBe('This coupon has been fully used');
  });

  it('counts guests by email, in any letter case', async () => {
    await createCoupon({});

    await guestCheckout('guest@example.com', total, 'SAVE10').expect(201);
    const again = await guestCheckout('GUEST@example.com', total, 'SAVE10').expect(409);
    expect(again.body.error.message).toBe('You have already used this coupon');

    const byEmail = await preview([{ variantId: shirt, quantity: 1 }], {
      couponCode: 'SAVE10',
      email: 'guest@example.com',
    });
    expect(byEmail.body.data.couponError).toBe('You have already used this coupon');
  });

  it('counts a customer and a guest with the same email together', async () => {
    await createCoupon({});

    await checkout([{ variantId: shirt, quantity: 1 }], total, 'SAVE10');
    const asGuest = await guestCheckout('customer@example.com', total, 'SAVE10').expect(409);
    expect(asGuest.body.error.message).toBe('You have already used this coupon');

    await guestCheckout('OTHER@example.com', total, 'SAVE10').expect(201);
    const asCustomer = await checkout(
      [{ variantId: shirt, quantity: 1 }],
      total,
      'SAVE10',
      409,
      other,
    );
    expect(asCustomer.body.error.message).toBe('You have already used this coupon');
  });

  it('can be closed to guests', async () => {
    await createCoupon({ allowGuests: false });

    const response = await guestCheckout('guest@example.com', total, 'SAVE10').expect(409);
    expect(response.body.error.message).toBe('Log in to use this coupon');

    const anonymous = await preview([{ variantId: shirt, quantity: 1 }], { couponCode: 'SAVE10' });
    const loggedIn = await preview(
      [{ variantId: shirt, quantity: 1 }],
      { couponCode: 'SAVE10' },
      customer.token,
    );
    expect(anonymous.body.data.couponError).toBe('Log in to use this coupon');
    expect(loggedIn.body.data.couponError).toBeNull();
  });

  it('rejects a bad token on the preview instead of ignoring it', async () => {
    await api()
      .post('/api/orders/preview')
      .set(bearer('not-a-token'))
      .send({ items: [] })
      .expect(401);
  });
});

describe('automatic discounts', () => {
  const auto = (code: string, discountValue: number, minSubtotalCents: number, body = {}) =>
    createCoupon({
      code,
      discountType: 'fixed',
      discountValue,
      minSubtotalCents,
      isAutomatic: true,
      ...body,
    });

  it('apply without a code, and the best tier wins', async () => {
    await auto('SPEND1500', 20000, 150000);
    await auto('SPEND5000', 70000, 500000);

    const two = await preview([{ variantId: shirt, quantity: 2 }]);
    const five = await preview([{ variantId: shirt, quantity: 5 }]);
    const one = await preview([{ variantId: shirt, quantity: 1 }]);

    expect(two.body.data).toMatchObject({
      discountCents: 20000,
      coupon: { code: 'SPEND1500', automatic: true },
      couponError: null,
    });
    expect(five.body.data.coupon.code).toBe('SPEND5000');
    expect(one.body.data.coupon).toBeNull();
  });

  it('give the shopper whichever of them or a typed coupon is better', async () => {
    await auto('AUTO200', 20000, 150000);
    await createCoupon({ code: 'TIE10', discountValue: 10 });
    await createCoupon({ code: 'BETTER15', discountValue: 15 });
    const items = [{ variantId: shirt, quantity: 2 }];

    const tie = await preview(items, { couponCode: 'TIE10' });
    expect(tie.body.data).toMatchObject({
      discountCents: 20000,
      coupon: { code: 'AUTO200', automatic: true },
      couponError: 'Your cart already gets a better discount (AUTO200)',
    });

    const better = await preview(items, { couponCode: 'BETTER15' });
    expect(better.body.data).toMatchObject({
      discountCents: 30000,
      coupon: { code: 'BETTER15', automatic: false },
      couponError: null,
    });
  });

  it('keep a losing typed coupon unused at checkout', async () => {
    await auto('AUTO200', 20000, 150000);
    await createCoupon({ code: 'TIE10', discountValue: 10 });

    const order = (
      await checkout([{ variantId: shirt, quantity: 2 }], 200000 - 20000 + shipping, 'TIE10')
    ).body.data;

    expect(order.couponCode).toBe('AUTO200');
    const list = await api().get(url).set(bearer(adminToken)).expect(200);
    const usage = Object.fromEntries(
      list.body.data.map((coupon: { code: string; usedCount: number }) => [
        coupon.code,
        coupon.usedCount,
      ]),
    );
    expect(usage).toEqual({ AUTO200: 1, TIE10: 0 });
  });

  it('work on every order by default', async () => {
    const coupon = await auto('AUTO200', 20000, 150000);
    expect(coupon.perCustomerLimit).toBeNull();

    const total = 200000 - 20000 + shipping;
    await checkout([{ variantId: shirt, quantity: 2 }], total, undefined);
    await checkout([{ variantId: shirt, quantity: 2 }], total, undefined);
  });

  it('stop at their limits, and only one parallel order gets the last use', async () => {
    await auto('ONCE', 20000, 150000, { usageLimit: 1 });
    const items = [{ variantId: shirt, quantity: 2 }];
    const discounted = 200000 - 20000 + shipping;

    const responses = await Promise.all([
      checkout(items, discounted, undefined, null),
      checkout(items, discounted, undefined, null, other),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);

    const after = await preview(items);
    expect(after.body.data.coupon).toBeNull();
  });
});

describe('free shipping over an amount', () => {
  it('waives shipping once the subtotal after discounts reaches it', async () => {
    env.FREE_SHIPPING_MIN_CENTS = 150000;

    const over = await preview([{ variantId: shirt, quantity: 2 }]);
    const under = await preview([{ variantId: shirt, quantity: 1 }]);

    expect(over.body.data).toMatchObject({ shippingCents: 0, totalCents: 200000 });
    expect(under.body.data.shippingCents).toBe(shipping);
  });

  it('adds to a coupon, unless the coupon takes the order under the amount', async () => {
    env.FREE_SHIPPING_MIN_CENTS = 150000;
    await createCoupon({});
    await createCoupon({ code: 'LESS600', discountType: 'fixed', discountValue: 60000 });
    const items = [{ variantId: shirt, quantity: 2 }];

    const stacked = await preview(items, { couponCode: 'SAVE10' });
    const under = await preview(items, { couponCode: 'LESS600' });

    expect(stacked.body.data).toMatchObject({ discountCents: 20000, shippingCents: 0 });
    expect(under.body.data).toMatchObject({
      discountCents: 60000,
      shippingCents: shipping,
      totalCents: 140000 + shipping,
    });

    const order = (await checkout(items, 180000, 'SAVE10')).body.data;
    expect(order).toMatchObject({ shippingCents: 0, totalCents: 180000 });
  });

  it('tells the storefront how much more earns free shipping', async () => {
    const remaining = async (items: object[], body: object = {}) => {
      const data = (await preview(items, body)).body.data;
      return [data.freeShippingMinCents, data.freeShippingRemainingCents, data.shippingCents];
    };

    expect(await remaining([{ variantId: shirt, quantity: 1 }])).toEqual([null, null, shipping]);

    env.FREE_SHIPPING_MIN_CENTS = 150000;
    await createCoupon({ code: 'LESS600', discountType: 'fixed', discountValue: 60000 });
    await createCoupon({ code: 'FREESHIP', discountType: 'free_shipping' });
    const both = [
      { variantId: shirt, quantity: 1 },
      { variantId: cap, quantity: 1 },
    ];

    expect(await remaining([{ variantId: shirt, quantity: 1 }])).toEqual([150000, 50000, shipping]);
    expect(await remaining(both)).toEqual([150000, 0, 0]);
    // The coupon wins, even though it leaves 1,400 and brings shipping back.
    expect(await remaining([{ variantId: shirt, quantity: 2 }], { couponCode: 'LESS600' })).toEqual(
      [150000, 10000, shipping],
    );
    expect(
      await remaining([{ variantId: shirt, quantity: 1 }], { couponCode: 'FREESHIP' }),
    ).toEqual([150000, 0, 0]);
  });

  it('says when a coupon does not lower the total', async () => {
    env.FREE_SHIPPING_MIN_CENTS = 150000;
    await createCoupon({ code: 'FREESHIP', discountType: 'free_shipping' });

    const response = await preview([{ variantId: shirt, quantity: 2 }], {
      couponCode: 'FREESHIP',
    });

    expect(response.body.data).toMatchObject({
      coupon: null,
      couponError: 'This coupon does not lower your total',
    });
  });
});

describe('abuse', () => {
  it('limits coupon attempts per address, without counting requests that have none', async () => {
    const items = [{ variantId: shirt, quantity: 1 }];

    for (let attempt = 0; attempt < 60; attempt++) {
      await preview(items, { couponCode: `GUESS${attempt}` });
    }

    await api().post('/api/orders/preview').send({ items, couponCode: 'GUESS60' }).expect(429);
    await preview(items);
  });

  it('gives an unpaid order with a limited coupon a shorter time to pay', async () => {
    await createCoupon({ usageLimit: 100 });

    const order = (
      await guestCheckout('guest@example.com', 100000 - 10000 + shipping, 'SAVE10').expect(201)
    ).body.data;
    const hoursToPay = (new Date(order.paymentDueAt).getTime() - Date.now()) / hour;

    expect(hoursToPay).toBeGreaterThan(0.9);
    expect(hoursToPay).toBeLessThanOrEqual(1);
  });

  it('marks an order that costs nothing as paid, instead of waiting for a payment', async () => {
    env.FREE_SHIPPING_MIN_CENTS = 0;
    await createCoupon({ code: 'FREE', discountValue: 100 });

    const order = (await guestCheckout('guest@example.com', 0, 'FREE').expect(201)).body.data;

    expect(order).toMatchObject({
      totalCents: 0,
      status: 'pending',
      paymentStatus: 'paid',
      paymentDueAt: null,
      payment: null,
    });
  });
});

describe('managing coupons', () => {
  it('needs promotions.manage', async () => {
    await api().get(url).expect(401);
    await api().get(url).set(bearer(customer.token)).expect(403);
    await api().get(url).set(bearer(adminRoleToken)).expect(200);
  });

  it('creates, reads, updates, and deletes a coupon', async () => {
    const coupon = await createCoupon({ code: 'hello-world' });

    expect(coupon).toMatchObject({
      code: 'HELLO-WORLD',
      discountType: 'percent',
      discountValue: 10,
      perCustomerLimit: 1,
      allowSaleItems: false,
      allowGuests: true,
      isActive: true,
      usedCount: 0,
      discountGivenCents: 0,
    });

    const updated = await api()
      .patch(`${url}/${coupon.id}`)
      .set(bearer(adminToken))
      .send({ discountType: 'free_shipping', perCustomerLimit: null })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      discountType: 'free_shipping',
      discountValue: null,
      perCustomerLimit: null,
    });

    await api().get(`${url}/${coupon.id}`).set(bearer(adminToken)).expect(200);
    await api().delete(`${url}/${coupon.id}`).set(bearer(adminToken)).expect(204);
    await api().get(`${url}/${coupon.id}`).set(bearer(adminToken)).expect(404);
  });

  it('rejects invalid coupons', async () => {
    const send = (body: object) =>
      api()
        .post(url)
        .set(bearer(adminToken))
        .send({ code: 'SAVE10', discountType: 'percent', discountValue: 10, ...body });

    await send({ discountValue: 101 }).expect(400);
    await send({ discountType: 'fixed', discountValue: null }).expect(400);
    await send({ code: 'no spaces' }).expect(400);
    await send({ code: 'AB' }).expect(400);
    await send({
      startsAt: new Date(Date.now() + hour).toISOString(),
      endsAt: new Date().toISOString(),
    }).expect(400);

    await createCoupon({});
    const duplicate = await send({ code: 'save10' }).expect(409);
    expect(duplicate.body.error.message).toBe('A coupon with this code already exists');

    await api()
      .patch(`${url}/${missingId}`)
      .set(bearer(adminToken))
      .send({ isActive: false })
      .expect(404);
  });

  it('keeps a used coupon, which can only be turned off', async () => {
    const coupon = await createCoupon({});
    await checkout([{ variantId: shirt, quantity: 1 }], 100000 - 10000 + shipping, 'SAVE10');

    const response = await api().delete(`${url}/${coupon.id}`).set(bearer(adminToken)).expect(409);
    expect(response.body.error.message).toBe('Orders use this coupon, so turn it off instead');
  });

  it('records each change in the audit log', async () => {
    const coupon = await createCoupon({});
    await api()
      .patch(`${url}/${coupon.id}`)
      .set(bearer(adminToken))
      .send({ discountValue: 15 })
      .expect(200);
    await api().delete(`${url}/${coupon.id}`).set(bearer(adminToken)).expect(204);

    const entries = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'coupon'), eq(auditLogs.entityId, coupon.id)))
      .orderBy(auditLogs.createdAt);

    expect(entries.map((entry) => entry.action)).toEqual(['create', 'update', 'delete']);
    expect(entries[1]?.changes).toEqual({ discountValue: [10, 15] });
  });
});
