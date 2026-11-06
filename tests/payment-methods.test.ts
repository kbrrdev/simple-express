import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import { categories, orders, products, productVariants, users } from '../src/db/schema';
import { guestOrderLimiter } from '../src/modules/orders/order.routes';
import { expireUnpaidOrders } from '../src/modules/orders/order.service';

const password = 'correct-horse-battery';
const missingId = '00000000-0000-4000-8000-000000000000';
const url = '/api/payment-methods';
const total = 122000;

const gcash = {
  providerName: 'GCash',
  accountName: 'Juan Dela Cruz',
  accountNumber: '09171234567',
};

const address = {
  recipientName: 'Juan Dela Cruz',
  phone: '09171234567',
  line1: '123 Rizal Street',
  barangay: 'San Antonio',
  city: 'Pasig',
  province: 'Metro Manila',
  postalCode: '1605',
};

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminToken: string;
let token: string;
let addressId: string;
let variantId: string;

async function registerAndLogin(email: string) {
  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

const asAdmin = {
  post: (path: string, body: object) => api().post(path).set(bearer(adminToken)).send(body),
  patch: (path: string, body: object) => api().patch(path).set(bearer(adminToken)).send(body),
  delete: (path: string) => api().delete(path).set(bearer(adminToken)),
  get: (path: string) => api().get(path).set(bearer(adminToken)),
};

async function createMethod(body: object = gcash) {
  const response = await asAdmin.post(url, body).expect(201);
  return response.body.data;
}

async function uploadQr() {
  const response = await api()
    .post('/api/assets')
    .set(bearer(adminToken))
    .attach('file', png, 'qr.png')
    .expect(201);

  return response.body.data as { id: string; url: string };
}

async function placeOrder(paymentMethod: string) {
  await api()
    .post('/api/cart/items')
    .set(bearer(token))
    .send({ variantId, quantity: 1 })
    .expect(200);

  return api().post('/api/orders').set(bearer(token)).send({
    addressId,
    paymentMethod,
    expectedTotalCents: total,
    idempotencyKey: randomUUID(),
  });
}

const placeGuestOrder = (paymentMethod: string) =>
  api()
    .post('/api/orders/guest')
    .send({
      email: 'guest@example.com',
      address,
      items: [{ variantId, quantity: 1 }],
      paymentMethod,
      expectedTotalCents: total,
      idempotencyKey: randomUUID(),
    });

const getOrder = async (id: string) =>
  (await api().get(`/api/orders/${id}`).set(bearer(token)).expect(200)).body.data;

const payAndConfirm = async (id: string) => {
  await api()
    .post(`/api/orders/${id}/payment`)
    .set(bearer(token))
    .send({ reference: `REF-${randomUUID().slice(0, 12)}` })
    .expect(200);
  await api().post(`/api/orders/admin/${id}/payment/confirm`).set(bearer(adminToken)).expect(200);
};

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  adminToken = await registerAndLogin('admin@example.com');
  await db.update(users).set({ role: 'admin' }).where(eq(users.email, 'admin@example.com'));
  token = await registerAndLogin('customer@example.com');
});

beforeEach(async () => {
  await db.execute(
    sql`truncate table categories, products, addresses, orders, payment_methods, assets cascade`,
  );

  for (const key of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
    await guestOrderLimiter.resetKey(key);
  }

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

  addressId = (await api().post('/api/addresses').set(bearer(token)).send(address).expect(201)).body
    .data.id;
});

afterAll(async () => {
  await pool.end();
});

describe('choosing a method', () => {
  it('is public, and lists enabled methods without account details', async () => {
    const method = await createMethod();
    await createMethod({ ...gcash, providerName: 'Maya', enabled: false });

    const response = await api().get(url).expect(200);

    expect(response.body.data).toEqual([{ id: method.id, type: 'manual', providerName: 'GCash' }]);
    expect(response.body.meta).toEqual({ page: 1, limit: 1, total: 1 });
  });
});

describe('managing methods', () => {
  it('only allows admins', async () => {
    const method = await createMethod();
    const path = `${url}/${method.id}`;

    await api().get(`${url}/admin`).expect(401);
    await api().get(`${url}/admin`).set(bearer(token)).expect(403);
    await api().post(url).send(gcash).expect(401);
    await api().post(url).set(bearer(token)).send(gcash).expect(403);
    await api().patch(path).set(bearer(token)).send({ enabled: false }).expect(403);
    await api().delete(path).set(bearer(token)).expect(403);
  });

  it('supports any provider, including banks and PayPal', async () => {
    await createMethod();
    await createMethod({ ...gcash, providerName: 'Maya' });
    await createMethod({ ...gcash, providerName: 'BDO', accountNumber: '1234 5678 90' });
    await createMethod({ ...gcash, providerName: 'BPI', accountNumber: '0987654321' });
    await createMethod({ ...gcash, providerName: 'PayPal', accountNumber: 'juan@example.com' });

    const response = await asAdmin.get(`${url}/admin`).expect(200);

    expect(response.body.data.map((row: { providerName: string }) => row.providerName)).toEqual([
      'BDO',
      'BPI',
      'GCash',
      'Maya',
      'PayPal',
    ]);
  });

  it('allows two accounts with one provider', async () => {
    await createMethod();
    await createMethod({ ...gcash, accountNumber: '09187654321' });
  });

  it('rejects the same account twice', async () => {
    const method = await createMethod();
    const other = await createMethod({ ...gcash, accountNumber: '09187654321' });

    await asAdmin.post(url, gcash).expect(409);
    await asAdmin.patch(`${url}/${other.id}`, { accountNumber: gcash.accountNumber }).expect(409);
    await asAdmin.patch(`${url}/${method.id}`, { accountName: 'Maria' }).expect(200);
  });

  it.each(['providerName', 'accountName', 'accountNumber'])('requires %s', async (field) => {
    await asAdmin.post(url, { ...gcash, [field]: undefined }).expect(400);
    await asAdmin.post(url, { ...gcash, [field]: '  ' }).expect(400);
  });

  it('rejects unknown fields and bad input', async () => {
    const method = await createMethod();

    await asAdmin.post(url, { ...gcash, type: 'online' }).expect(400);
    await asAdmin.post(url, { ...gcash, qrAssetId: 'nope' }).expect(400);
    await asAdmin.patch(`${url}/${method.id}`, {}).expect(400);
    await asAdmin.patch(`${url}/nope`, { enabled: false }).expect(400);
  });

  it('sets, shows and clears a QR', async () => {
    const qr = await uploadQr();
    const method = await createMethod({ ...gcash, qrAssetId: qr.id });

    expect(method.qrUrl).toBe(qr.url);

    const cleared = await asAdmin.patch(`${url}/${method.id}`, { qrAssetId: null }).expect(200);

    expect(cleared.body.data).toMatchObject({ qrAssetId: null, qrUrl: null });
  });

  it('rejects an unknown QR asset', async () => {
    await asAdmin.post(url, { ...gcash, qrAssetId: missingId }).expect(400);
  });

  it('blocks deleting a QR that a method uses', async () => {
    const qr = await uploadQr();
    await createMethod({ ...gcash, qrAssetId: qr.id });

    await asAdmin.delete(`/api/assets/${qr.id}`).expect(409);
  });

  it('deletes an unused method', async () => {
    const method = await createMethod();

    await asAdmin.delete(`${url}/${method.id}`).expect(204);
    await asAdmin.delete(`${url}/${method.id}`).expect(404);
    await asAdmin.patch(`${url}/${method.id}`, { enabled: false }).expect(404);
  });

  it('blocks deleting a method that orders use, which can be turned off instead', async () => {
    const method = await createMethod();
    await placeOrder(method.id);

    const response = await asAdmin.delete(`${url}/${method.id}`).expect(409);

    expect(response.body.error.message).toBe(
      'Orders use this payment method, so turn it off instead',
    );
    await asAdmin.patch(`${url}/${method.id}`, { enabled: false }).expect(200);
  });
});

describe('paying with a method', () => {
  it('shows who to pay, and how much', async () => {
    const qr = await uploadQr();
    const method = await createMethod({ ...gcash, qrAssetId: qr.id });

    const response = await placeOrder(method.id);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      status: 'awaiting_payment',
      paymentType: 'manual',
      paymentProvider: 'GCash',
      totalCents: total,
      payment: {
        providerName: 'GCash',
        accountName: 'Juan Dela Cruz',
        accountNumber: '09171234567',
        qrUrl: qr.url,
      },
    });
  });

  it('works with no QR', async () => {
    const method = await createMethod();

    const response = await placeOrder(method.id);

    expect(response.body.data.payment.qrUrl).toBeNull();
  });

  it('keeps COD separate from the list', async () => {
    const response = await placeOrder('cod');

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      status: 'pending',
      paymentType: 'cod',
      paymentProvider: null,
      payment: null,
    });
  });

  it('rejects a method that is turned off or does not exist', async () => {
    const method = await createMethod({ ...gcash, enabled: false });

    const off = await placeOrder(method.id);
    const missing = await placeOrder(missingId);

    expect(off.status).toBe(409);
    expect(off.body.error.message).toBe('This payment method is not available');
    expect(missing.status).toBe(409);
    expect(await db.select().from(orders)).toEqual([]);
  });

  it('rejects a bad value', async () => {
    const response = await placeOrder('gcash');

    expect(response.status).toBe(400);
  });

  it('lets an existing order keep its account when the method changes', async () => {
    const first = await uploadQr();
    const second = await uploadQr();
    const method = await createMethod({ ...gcash, qrAssetId: first.id });
    const order = (await placeOrder(method.id)).body.data;

    await asAdmin
      .patch(`${url}/${method.id}`, {
        accountName: 'New Owner',
        accountNumber: '09189999999',
        providerName: 'Maya',
        qrAssetId: second.id,
      })
      .expect(200);

    expect((await getOrder(order.id)).payment).toEqual({
      providerName: 'GCash',
      accountName: 'Juan Dela Cruz',
      accountNumber: '09171234567',
      qrUrl: first.url,
    });

    const next = (await placeOrder(method.id)).body.data;

    expect(next.payment).toMatchObject({ accountName: 'New Owner', qrUrl: second.url });
  });

  it('lets an existing order keep its account when the method is turned off', async () => {
    const method = await createMethod();
    const order = (await placeOrder(method.id)).body.data;

    await asAdmin.patch(`${url}/${method.id}`, { enabled: false }).expect(200);

    expect((await getOrder(order.id)).payment.accountNumber).toBe(gcash.accountNumber);
  });

  it('blocks deleting a QR that an unpaid order still shows', async () => {
    const qr = await uploadQr();
    const method = await createMethod({ ...gcash, qrAssetId: qr.id });
    await placeOrder(method.id);

    await asAdmin.patch(`${url}/${method.id}`, { qrAssetId: null }).expect(200);

    await asAdmin.delete(`/api/assets/${qr.id}`).expect(409);
  });

  it('stops showing account details once paid', async () => {
    const qr = await uploadQr();
    const method = await createMethod({ ...gcash, qrAssetId: qr.id });
    const order = (await placeOrder(method.id)).body.data;

    await payAndConfirm(order.id);

    const paid = await getOrder(order.id);

    expect(paid.payment).toBeNull();
    expect(paid.paymentProvider).toBe('GCash');
  });

  it('stops showing account details once cancelled or expired', async () => {
    const method = await createMethod();
    const cancelled = (await placeOrder(method.id)).body.data;
    const expired = (await placeOrder(method.id)).body.data;

    await api().post(`/api/orders/${cancelled.id}/cancel`).set(bearer(token)).expect(200);
    await db
      .update(orders)
      .set({ paymentDueAt: new Date(Date.now() - 60000) })
      .where(eq(orders.id, expired.id));
    await expireUnpaidOrders();

    expect((await getOrder(cancelled.id)).payment).toBeNull();
    expect((await getOrder(expired.id)).payment).toBeNull();
  });

  it('keeps showing details after a reference is submitted', async () => {
    const method = await createMethod();
    const order = (await placeOrder(method.id)).body.data;

    await api()
      .post(`/api/orders/${order.id}/payment`)
      .set(bearer(token))
      .send({ reference: 'REF-123456' })
      .expect(200);

    expect((await getOrder(order.id)).payment.accountNumber).toBe(gcash.accountNumber);
  });

  it('stops one reference being used twice with one provider', async () => {
    const first = await createMethod();
    const second = await createMethod({ ...gcash, accountNumber: '09187654321' });
    const firstOrder = (await placeOrder(first.id)).body.data;
    const secondOrder = (await placeOrder(second.id)).body.data;
    const body = { reference: 'REF-123456' };

    await api()
      .post(`/api/orders/${firstOrder.id}/payment`)
      .set(bearer(token))
      .send(body)
      .expect(200);
    await api()
      .post(`/api/orders/${secondOrder.id}/payment`)
      .set(bearer(token))
      .send(body)
      .expect(409);
  });
});

describe('guests', () => {
  it('see the same payment details, and the private link keeps them', async () => {
    const qr = await uploadQr();
    const method = await createMethod({ ...gcash, qrAssetId: qr.id });

    const response = await placeGuestOrder(method.id);
    const order = response.body.data;

    expect(response.status).toBe(201);
    expect(order.payment).toMatchObject({ accountNumber: gcash.accountNumber, qrUrl: qr.url });

    const viewed = await api().get(`/api/orders/guest/${order.guestToken}`).expect(200);

    expect(viewed.body.data.payment).toEqual(order.payment);
  });

  it('cannot use COD', async () => {
    const response = await placeGuestOrder('cod');

    expect(response.status).toBe(400);
  });

  it('cannot use a method that is turned off', async () => {
    const method = await createMethod({ ...gcash, enabled: false });

    const response = await placeGuestOrder(method.id);

    expect(response.status).toBe(409);
  });
});
