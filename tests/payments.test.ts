import { createHmac, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { db, pool } from '../src/db';
import {
  categories,
  orders,
  paymentMethods,
  payments,
  products,
  productVariants,
  users,
} from '../src/db/schema';
import { guestOrderLimiter } from '../src/modules/orders/order.routes';
import { expireUnpaidOrders, markPaid } from '../src/modules/orders/order.service';

const password = 'correct-horse-battery';
const missingId = '00000000-0000-4000-8000-000000000000';
const total = 122000;

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
let variantId: string;
let gcashId: string;
let bankId: string;

const methodIds = () => ({ cod: 'cod', gcash: gcashId, bank_transfer: bankId });

async function registerAndLogin(email: string) {
  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

async function resetGuestLimit() {
  for (const key of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
    await guestOrderLimiter.resetKey(key);
  }
}

async function placeOrder(
  method: 'cod' | 'gcash' | 'bank_transfer' = 'gcash',
  user = token,
  addressForUser = addressId,
) {
  await api()
    .post('/api/cart/items')
    .set(bearer(user))
    .send({ variantId, quantity: 1 })
    .expect(200);

  const response = await api()
    .post('/api/orders')
    .set(bearer(user))
    .send({
      addressId: addressForUser,
      paymentMethod: methodIds()[method],
      expectedTotalCents: total,
      idempotencyKey: randomUUID(),
    })
    .expect(201);

  return response.body.data;
}

const guestBody = (overrides: object = {}) => ({
  email: 'guest@example.com',
  address,
  items: [{ variantId, quantity: 1 }],
  paymentMethod: gcashId,
  expectedTotalCents: total,
  idempotencyKey: randomUUID(),
  ...overrides,
});

const guestCheckout = (overrides: object = {}) =>
  api().post('/api/orders/guest').send(guestBody(overrides));

async function placeGuestOrder(overrides: object = {}) {
  const response = await guestCheckout(overrides).expect(201);
  return response.body.data;
}

const submit = (id: string, reference: string, user = token) =>
  api().post(`/api/orders/${id}/payment`).set(bearer(user)).send({ reference });

const adminPayment = (id: string, action: string, user = adminToken) =>
  api().post(`/api/orders/admin/${id}/payment/${action}`).set(bearer(user));

const setStatus = (id: string, status: string) =>
  api().patch(`/api/orders/admin/${id}/status`).set(bearer(adminToken)).send({ status });

const getAdminOrder = async (id: string) =>
  (await api().get(`/api/orders/admin/${id}`).set(bearer(adminToken)).expect(200)).body.data;

async function stock() {
  const [variant] = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, variantId));
  return variant?.stock;
}

const makeOverdue = (id: string) =>
  db
    .update(orders)
    .set({ paymentDueAt: new Date(Date.now() - 60000) })
    .where(eq(orders.id, id));

const reference = () => `GC-${randomUUID().slice(0, 12)}`;

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  adminToken = await registerAndLogin('admin@example.com');
  await db.update(users).set({ role: 'admin' }).where(eq(users.email, 'admin@example.com'));
  token = await registerAndLogin('customer@example.com');
  otherToken = await registerAndLogin('other@example.com');
});

beforeEach(async () => {
  await db.execute(
    sql`truncate table categories, products, addresses, orders, payment_methods cascade`,
  );
  await resetGuestLimit();

  const [category] = await db.insert(categories).values({ name: 'Shirts' }).returning();
  if (!category) throw new Error('Failed to insert category');

  const [product] = await db
    .insert(products)
    .values({ categoryId: category.id, name: 'Classic T-Shirt' })
    .returning();
  if (!product) throw new Error('Failed to insert product');

  const [variant] = await db
    .insert(productVariants)
    .values({ productId: product.id, priceCents: 112000, stock: 10 })
    .returning();
  if (!variant) throw new Error('Failed to insert variant');
  variantId = variant.id;

  const [gcash, bank] = await db
    .insert(paymentMethods)
    .values([
      { providerName: 'GCash', accountName: 'Juan Dela Cruz', accountNumber: '09170000000' },
      { providerName: 'BDO', accountName: 'Juan Dela Cruz', accountNumber: '1234567890' },
    ])
    .returning();
  if (!gcash || !bank) throw new Error('Failed to insert payment methods');
  gcashId = gcash.id;
  bankId = bank.id;

  addressId = (await api().post('/api/addresses').set(bearer(token)).send(address).expect(201)).body
    .data.id;
  otherAddressId = (
    await api().post('/api/addresses').set(bearer(otherToken)).send(address).expect(201)
  ).body.data.id;
});

afterEach(() => {
  env.PAYMENT_WINDOW_HOURS = 24;
});

afterAll(async () => {
  await pool.end();
});

describe('placing a manual payment order', () => {
  it('waits for payment and shows where to pay', async () => {
    const order = await placeOrder('gcash');

    expect(order).toMatchObject({
      status: 'awaiting_payment',
      paymentType: 'manual',
      paymentProvider: 'GCash',
      paymentStatus: 'unpaid',
    });
    expect(order.payment.accountNumber).toBe('09170000000');
  });

  it('shows bank details for a bank transfer', async () => {
    const order = await placeOrder('bank_transfer');

    expect(order.payment).toMatchObject({ providerName: 'BDO', accountNumber: '1234567890' });
  });

  it('holds stock and sets the deadline from the setting', async () => {
    env.PAYMENT_WINDOW_HOURS = 2;
    const before = Date.now();

    const order = await placeOrder('gcash');
    const due = new Date(order.paymentDueAt).getTime();

    expect(await stock()).toBe(9);
    expect(due).toBeGreaterThanOrEqual(before + 2 * 60 * 60 * 1000);
    expect(due).toBeLessThan(before + 2 * 60 * 60 * 1000 + 60000);
  });

  it('gives COD orders no deadline or details', async () => {
    const order = await placeOrder('cod');

    expect(order).toMatchObject({ status: 'pending', paymentDueAt: null, payment: null });
  });

  it('can be cancelled by the customer while unpaid, returning stock', async () => {
    const order = await placeOrder('gcash');

    const response = await api()
      .post(`/api/orders/${order.id}/cancel`)
      .set(bearer(token))
      .expect(200);

    expect(response.body.data).toMatchObject({ status: 'cancelled', paymentDueAt: null });
    expect(await stock()).toBe(10);
  });

  it('can be cancelled by an admin while unpaid', async () => {
    const order = await placeOrder('gcash');

    await setStatus(order.id, 'cancelled').expect(200);

    expect(await stock()).toBe(10);
  });

  it('cannot skip payment through a status change', async () => {
    const order = await placeOrder('gcash');

    await setStatus(order.id, 'confirmed').expect(409);
    await setStatus(order.id, 'shipped').expect(409);
    await setStatus(order.id, 'delivered').expect(409);
  });
});

describe('submitting a reference', () => {
  it('marks the payment as submitted', async () => {
    const order = await placeOrder();

    const response = await submit(order.id, 'GC-1234567890').expect(200);

    expect(response.body.data).toMatchObject({
      status: 'awaiting_payment',
      paymentStatus: 'submitted',
    });
    expect((await getAdminOrder(order.id)).paymentReference).toBe('GC-1234567890');
  });

  it('records the amount and method', async () => {
    const order = await placeOrder('bank_transfer');

    await submit(order.id, 'BANK-0001').expect(200);

    const [payment] = await db.select().from(payments);

    expect(payment).toMatchObject({
      orderId: order.id,
      provider: 'BDO',
      amountCents: total,
      reference: 'BANK-0001',
    });
  });

  it('cannot be submitted twice', async () => {
    const order = await placeOrder();

    await submit(order.id, reference()).expect(200);
    await submit(order.id, reference()).expect(409);
  });

  it('accepts one of several parallel submissions', async () => {
    const order = await placeOrder();

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => submit(order.id, reference())),
    );

    expect(responses.filter(({ status }) => status === 200)).toHaveLength(1);
    expect(await db.select().from(payments)).toHaveLength(1);
  });

  it('cannot reuse a reference on another order', async () => {
    const shared = 'GC-1234567890';
    const first = await placeOrder();
    const second = await placeOrder();

    await submit(first.id, shared).expect(200);
    const response = await submit(second.id, shared).expect(409);

    expect(response.body.error.message).toBe('This payment reference has already been used');
    expect((await getAdminOrder(second.id)).paymentStatus).toBe('unpaid');
  });

  it('allows the same reference with a different provider', async () => {
    const gcash = await placeOrder('gcash');
    const bank = await placeOrder('bank_transfer');

    await submit(gcash.id, 'SAME-1234').expect(200);
    await submit(bank.id, 'SAME-1234').expect(200);
  });

  it('is not needed for COD', async () => {
    const order = await placeOrder('cod');

    await submit(order.id, reference()).expect(409);
  });

  it("is hidden for another user's order", async () => {
    const order = await placeOrder();

    await submit(order.id, reference(), otherToken).expect(404);
  });

  it('requires a token', async () => {
    const order = await placeOrder();

    await api()
      .post(`/api/orders/${order.id}/payment`)
      .send({ reference: reference() })
      .expect(401);
  });

  it.each(['abc', 'has spaces', "x'; drop table orders;--", 'a'.repeat(101)])(
    'rejects the reference %s',
    async (value) => {
      const order = await placeOrder();

      await submit(order.id, value).expect(400);
    },
  );

  it('blocks the customer from cancelling after submitting', async () => {
    const order = await placeOrder();
    await submit(order.id, reference()).expect(200);

    await api().post(`/api/orders/${order.id}/cancel`).set(bearer(token)).expect(409);
  });
});

describe('confirming a payment', () => {
  const submitted = async () => {
    const order = await placeOrder();
    await submit(order.id, reference()).expect(200);
    return order;
  };

  it('marks it paid and moves the order to pending', async () => {
    const order = await submitted();

    const response = await adminPayment(order.id, 'confirm').expect(200);

    expect(response.body.data).toMatchObject({
      status: 'pending',
      paymentStatus: 'paid',
      paymentDueAt: null,
      payment: null,
    });
    expect(await stock()).toBe(9);
  });

  it('only allows admins', async () => {
    const order = await submitted();

    await adminPayment(order.id, 'confirm', token).expect(403);
    await adminPayment(order.id, 'reject', token).expect(403);
    await adminPayment(order.id, 'refund', token).expect(403);
    await api().post(`/api/orders/admin/${order.id}/payment/confirm`).expect(401);
  });

  it('needs a submitted reference', async () => {
    const order = await placeOrder();
    const cod = await placeOrder('cod');

    await adminPayment(order.id, 'confirm').expect(409);
    await adminPayment(order.id, 'reject').expect(409);
    await adminPayment(cod.id, 'confirm').expect(409);
    await adminPayment(missingId, 'confirm').expect(404);
  });

  it('only works once', async () => {
    const order = await submitted();

    await adminPayment(order.id, 'confirm').expect(200);
    await adminPayment(order.id, 'confirm').expect(409);
    await adminPayment(order.id, 'reject').expect(409);
  });

  it('continues through to delivery and stays paid', async () => {
    const order = await submitted();
    await adminPayment(order.id, 'confirm').expect(200);

    await setStatus(order.id, 'confirmed').expect(200);
    await setStatus(order.id, 'shipped').expect(200);
    const response = await setStatus(order.id, 'delivered').expect(200);

    expect(response.body.data).toMatchObject({ status: 'delivered', paymentStatus: 'paid' });
  });

  it('lists submitted payments for review', async () => {
    const order = await submitted();
    await placeOrder();

    const response = await api()
      .get('/api/orders/admin?paymentStatus=submitted')
      .set(bearer(adminToken))
      .expect(200);

    expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([order.id]);
    expect(response.body.data[0].paymentReference).toMatch(/^GC-/);
  });

  it('applies only one of a parallel confirm and reject', async () => {
    const order = await submitted();

    const responses = await Promise.all([
      adminPayment(order.id, 'confirm'),
      adminPayment(order.id, 'reject'),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);

    const final = await getAdminOrder(order.id);
    const expectedStock = final.status === 'cancelled' ? 10 : 9;

    expect(await stock()).toBe(expectedStock);
  });
});

describe('rejecting a payment', () => {
  it('cancels the order and returns stock once', async () => {
    const order = await placeOrder();
    await submit(order.id, reference()).expect(200);

    const response = await adminPayment(order.id, 'reject').expect(200);

    expect(response.body.data).toMatchObject({ status: 'cancelled', paymentStatus: 'unpaid' });
    expect(await stock()).toBe(10);

    await adminPayment(order.id, 'reject').expect(409);
    expect(await stock()).toBe(10);
  });
});

describe('refunds', () => {
  const paid = async () => {
    const order = await placeOrder();
    await submit(order.id, reference()).expect(200);
    await adminPayment(order.id, 'confirm').expect(200);
    return order;
  };

  it('requires a paid order', async () => {
    const order = await placeOrder();

    const response = await adminPayment(order.id, 'refund').expect(409);

    expect(response.body.error.message).toBe('Only a paid order can be refunded');
  });

  it('requires a finished order', async () => {
    const order = await paid();

    const response = await adminPayment(order.id, 'refund').expect(409);

    expect(response.body.error.message).toBe('Cancel this order before refunding it');
  });

  it('records a refund on a cancelled order', async () => {
    const order = await paid();
    await setStatus(order.id, 'cancelled').expect(200);

    const response = await adminPayment(order.id, 'refund').expect(200);

    expect(response.body.data).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded' });
    expect(await stock()).toBe(10);
  });

  it('records a refund on a returned order, without touching stock', async () => {
    const order = await paid();
    await setStatus(order.id, 'confirmed').expect(200);
    await setStatus(order.id, 'shipped').expect(200);
    await setStatus(order.id, 'returned').expect(200);

    await adminPayment(order.id, 'refund').expect(200);

    expect(await stock()).toBe(9);
  });

  it('cannot refund twice', async () => {
    const order = await paid();
    await setStatus(order.id, 'cancelled').expect(200);

    await adminPayment(order.id, 'refund').expect(200);
    await adminPayment(order.id, 'refund').expect(409);
  });
});

describe('markPaid', () => {
  it('is safe to repeat, as a provider webhook may arrive twice', async () => {
    const order = await placeOrder();

    await db.transaction((tx) => markPaid(tx, order.id));
    await setStatus(order.id, 'confirmed').expect(200);
    await db.transaction((tx) => markPaid(tx, order.id));

    const final = await getAdminOrder(order.id);

    expect(final).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
  });
});

describe('expiring unpaid orders', () => {
  it('cancels overdue orders and returns stock', async () => {
    const order = await placeOrder();
    await makeOverdue(order.id);

    expect(await expireUnpaidOrders()).toBe(1);

    expect(await getAdminOrder(order.id)).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'unpaid',
    });
    expect(await stock()).toBe(10);
  });

  it('leaves orders that are not yet due', async () => {
    const order = await placeOrder();

    expect(await expireUnpaidOrders()).toBe(0);

    expect((await getAdminOrder(order.id)).status).toBe('awaiting_payment');
  });

  it('never expires an order with a submitted reference', async () => {
    const order = await placeOrder();
    await submit(order.id, reference()).expect(200);
    await makeOverdue(order.id);

    expect(await expireUnpaidOrders()).toBe(0);

    expect((await getAdminOrder(order.id)).paymentStatus).toBe('submitted');
    expect(await stock()).toBe(9);
  });

  it('leaves COD orders and paid orders alone', async () => {
    const cod = await placeOrder('cod');
    const paid = await placeOrder();
    await submit(paid.id, reference()).expect(200);
    await adminPayment(paid.id, 'confirm').expect(200);
    await db.update(orders).set({ paymentDueAt: new Date(Date.now() - 60000) });

    expect(await expireUnpaidOrders()).toBe(0);

    expect((await getAdminOrder(cod.id)).status).toBe('pending');
    expect((await getAdminOrder(paid.id)).status).toBe('pending');
  });

  it('returns stock once when repeated', async () => {
    const order = await placeOrder();
    await makeOverdue(order.id);

    await expireUnpaidOrders();
    await expireUnpaidOrders();

    expect(await stock()).toBe(10);
  });

  it('returns stock once when run by several servers at once', async () => {
    for (let index = 0; index < 5; index++) {
      await makeOverdue((await placeOrder()).id);
    }

    const counts = await Promise.all(Array.from({ length: 6 }, () => expireUnpaidOrders()));

    expect(counts.reduce((total, count) => total + count, 0)).toBe(5);
    expect(await stock()).toBe(10);
  });

  it('rejects a reference after the order expired', async () => {
    const order = await placeOrder();
    await makeOverdue(order.id);
    await expireUnpaidOrders();

    await submit(order.id, reference()).expect(409);
  });

  it('applies one outcome when expiry races a submitted reference', async () => {
    const order = await placeOrder();
    await makeOverdue(order.id);

    const [response] = await Promise.all([submit(order.id, reference()), expireUnpaidOrders()]);
    const final = await getAdminOrder(order.id);

    if (response.status === 200) {
      expect(final.status).toBe('awaiting_payment');
      expect(await stock()).toBe(9);
    } else {
      expect(final.status).toBe('cancelled');
      expect(await stock()).toBe(10);
    }
  });
});

describe('guest checkout', () => {
  it('creates an order with no account', async () => {
    const order = await placeGuestOrder();

    expect(order).toMatchObject({ status: 'awaiting_payment', paymentProvider: 'GCash' });
    expect(order.guestToken).toContain(`${order.id}.`);
    expect(order.shippingAddress).toMatchObject({ phone: '+639171234567', line2: '' });
    expect(await stock()).toBe(9);

    const [row] = await db.select().from(orders);

    expect(row).toMatchObject({ userId: null, guestEmail: 'guest@example.com' });
  });

  it('requires an email', async () => {
    await guestCheckout({ email: undefined }).expect(400);
    await guestCheckout({ email: 'nope' }).expect(400);
  });

  it('stores the email in lowercase', async () => {
    await placeGuestOrder({ email: 'Guest@Example.com' });

    const [row] = await db.select().from(orders);

    expect(row?.guestEmail).toBe('guest@example.com');
  });

  it('does not allow COD', async () => {
    await guestCheckout({ paymentMethod: 'cod' }).expect(400);
    await guestCheckout({ paymentMethod: 'gcash' }).expect(400);

    expect(await stock()).toBe(10);
  });

  it('accepts a bank transfer', async () => {
    const order = await placeGuestOrder({ paymentMethod: bankId });

    expect(order.payment.providerName).toBe('BDO');
  });

  it('applies the address rules', async () => {
    await guestCheckout({ address: { ...address, phone: '0281234567' } }).expect(400);
    await guestCheckout({ address: { ...address, postalCode: '12' } }).expect(400);
    await guestCheckout({ address: { ...address, country: 'US' } }).expect(400);
    await guestCheckout({ address: undefined }).expect(400);
  });

  it('rejects bad items', async () => {
    await guestCheckout({ items: [] }).expect(400);
    await guestCheckout({ items: [{ variantId, quantity: 0 }] }).expect(400);
    await guestCheckout({
      items: [
        { variantId, quantity: 1 },
        { variantId, quantity: 1 },
      ],
    }).expect(400);
  });

  it('rejects a variant that does not exist or is inactive', async () => {
    await guestCheckout({ items: [{ variantId: missingId, quantity: 1 }] }).expect(409);

    await db.update(productVariants).set({ active: false });
    await guestCheckout().expect(409);
  });

  it('rejects a changed total and changes nothing', async () => {
    await guestCheckout({ expectedTotalCents: 1 }).expect(409);

    expect(await stock()).toBe(10);
    expect(await db.select().from(orders)).toEqual([]);
  });

  it('does not accept prices from the request', async () => {
    await guestCheckout({ items: [{ variantId, quantity: 1, unitPriceCents: 1 }] }).expect(400);
    await guestCheckout({ userId: missingId }).expect(400);
    await guestCheckout({ status: 'delivered' }).expect(400);
  });

  it('rejects more than the stock', async () => {
    const response = await guestCheckout({
      items: [{ variantId, quantity: 11 }],
      expectedTotalCents: 112000 * 11 + 10000,
    }).expect(409);

    expect(response.body.error.message).toBe('Some items do not have enough stock');
  });

  it('gives the last item to one of two guests', async () => {
    await db.update(productVariants).set({ stock: 1 });

    const responses = await Promise.all([
      guestCheckout({ email: 'one@example.com' }),
      guestCheckout({ email: 'two@example.com' }),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(await stock()).toBe(0);
  });

  it('returns the same order and link for a repeated key', async () => {
    const idempotencyKey = randomUUID();

    const first = await guestCheckout({ idempotencyKey }).expect(201);
    const second = await guestCheckout({ idempotencyKey }).expect(200);

    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.guestToken).toBe(first.body.data.guestToken);
    expect(await stock()).toBe(9);
  });

  it('creates one order from parallel requests with the same key', async () => {
    const idempotencyKey = randomUUID();

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => guestCheckout({ idempotencyKey })),
    );

    expect(responses.filter(({ status }) => status === 201)).toHaveLength(1);
    expect(responses.filter(({ status }) => status === 200)).toHaveLength(7);
    expect(await db.select().from(orders)).toHaveLength(1);
    expect(await stock()).toBe(9);
  });

  it('returns the original order to a retry after the item sells out', async () => {
    await db.update(productVariants).set({ stock: 1 });
    const idempotencyKey = randomUUID();

    const first = await guestCheckout({ idempotencyKey }).expect(201);
    const retry = await guestCheckout({ idempotencyKey }).expect(200);

    expect(await stock()).toBe(0);
    expect(retry.body.data.guestToken).toBe(first.body.data.guestToken);
  });

  it('rejects a cart with a missing item, even if the total matches the rest', async () => {
    const response = await guestCheckout({
      items: [
        { variantId, quantity: 1 },
        { variantId: missingId, quantity: 1 },
      ],
    }).expect(409);

    expect(response.body.error.details[0].field).toBe(missingId);
    expect(await stock()).toBe(10);
  });

  it('treats the same key from another email as a new order', async () => {
    const idempotencyKey = randomUUID();

    await placeGuestOrder({ idempotencyKey, email: 'one@example.com' });
    await placeGuestOrder({ idempotencyKey, email: 'two@example.com' });

    expect(await db.select().from(orders)).toHaveLength(2);
  });

  it('is rate limited', async () => {
    for (let index = 0; index < 10; index++) {
      await guestCheckout({ email: 'nope' }).expect(400);
    }

    await guestCheckout().expect(429);
  });

  it('expires like any other unpaid order', async () => {
    const order = await placeGuestOrder();
    await makeOverdue(order.id);

    await expireUnpaidOrders();

    expect(await stock()).toBe(10);
  });
});

describe('guest emails that belong to an account', () => {
  const email = 'customer@example.com';

  it('stays a guest order, and stays out of the account', async () => {
    const order = await placeGuestOrder({ email });

    const history = await api().get('/api/orders').set(bearer(token)).expect(200);

    expect(history.body.data).toEqual([]);
    await api().get(`/api/orders/${order.id}`).set(bearer(token)).expect(404);
    await submit(order.id, reference()).expect(404);
  });

  it('does not reveal that the account exists', async () => {
    const existing = await guestCheckout({ email }).expect(201);
    const unknown = await guestCheckout({ email: 'nobody@example.com' }).expect(201);

    expect(Object.keys(existing.body.data).sort()).toEqual(Object.keys(unknown.body.data).sort());
    expect(existing.body.data).not.toHaveProperty('email');
  });
});

describe('the private guest link', () => {
  const view = (guestToken: string) => api().get(`/api/orders/guest/${guestToken}`);

  it('opens the order without logging in', async () => {
    const order = await placeGuestOrder();

    const response = await view(order.guestToken).expect(200);

    expect(response.body.data.id).toBe(order.id);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('is sent with no-store on checkout too', async () => {
    const response = await guestCheckout().expect(201);

    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('cannot be guessed from the order id', async () => {
    const order = await placeGuestOrder();

    await view(order.id).expect(404);
    await view(order.orderNumber).expect(404);
    await view(`${order.id}.`).expect(404);
    await view(`${order.id}.bad-signature`).expect(404);
  });

  it('cannot open another order by swapping the id', async () => {
    const first = await placeGuestOrder({ email: 'one@example.com' });
    const second = await placeGuestOrder({ email: 'two@example.com' });
    const signature = first.guestToken.split('.')[1];

    await view(`${second.id}.${signature}`).expect(404);
  });

  it('cannot open a customer order', async () => {
    const order = await placeOrder();
    const guest = await placeGuestOrder();
    const signature = guest.guestToken.split('.')[1];

    await view(`${order.id}.${signature}`).expect(404);
  });

  it('refuses a customer order even with a correct signature', async () => {
    const order = await placeOrder();
    const signature = createHmac('sha256', env.JWT_SECRET)
      .update(`guest-order:${order.id}`)
      .digest('base64url');

    await view(`${order.id}.${signature}`).expect(404);
  });

  it('is rejected when too long', async () => {
    await view('a'.repeat(121)).expect(400);
  });

  it('is not usable as a customer route', async () => {
    const order = await placeGuestOrder();

    await api().get(`/api/orders/${order.id}`).expect(401);
    await api().get(`/api/orders/${order.id}`).set(bearer(otherToken)).expect(404);
  });
});

describe('guest payments', () => {
  const submitGuest = (guestToken: string, value: string) =>
    api().post(`/api/orders/guest/${guestToken}/payment`).send({ reference: value });

  it('submits a reference, which an admin can confirm', async () => {
    const order = await placeGuestOrder();

    const submitted = await submitGuest(order.guestToken, reference()).expect(200);

    expect(submitted.body.data.paymentStatus).toBe('submitted');

    await adminPayment(order.id, 'confirm').expect(200);

    const viewed = await api().get(`/api/orders/guest/${order.guestToken}`).expect(200);

    expect(viewed.body.data).toMatchObject({ status: 'pending', paymentStatus: 'paid' });
  });

  it('rejects a bad link', async () => {
    const order = await placeGuestOrder();

    await submitGuest(`${order.id}.bad`, reference()).expect(404);
    await submitGuest(order.id, reference()).expect(404);
  });

  it('shows admins that it is a guest order', async () => {
    const order = await placeGuestOrder();

    expect(await getAdminOrder(order.id)).toMatchObject({
      isGuest: true,
      userId: null,
      customerEmail: 'guest@example.com',
    });
  });

  it('shows admins a normal customer', async () => {
    const order = await placeOrder('gcash', otherToken, otherAddressId);

    expect(await getAdminOrder(order.id)).toMatchObject({
      isGuest: false,
      customerEmail: 'other@example.com',
    });
  });
});
