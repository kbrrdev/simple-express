import { randomUUID } from 'node:crypto';
import { connect, type AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { db, pool } from '../src/db';
import {
  categories,
  paymentMethods,
  products,
  productVariants,
  SUPER_ADMIN_ROLE_ID,
  users,
} from '../src/db/schema';
import { createLogger, logger } from '../src/lib/logger';
import {
  logContext,
  recentSteps,
  recordStep,
  runWithContext,
  setUserId,
} from '../src/lib/request-context';
import { guestOrderLimiter } from '../src/modules/orders/order.routes';
import { expireUnpaidOrders } from '../src/modules/orders/order.service';

const password = 'correct-horse-battery';
const adminEmail = 'logging-admin@example.com';
const customerEmail = 'logging-customer@example.com';
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

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);

interface Entry {
  level: 'info' | 'warn' | 'error';
  fields: Record<string, unknown>;
  message: string;
  context: { requestId?: string; userId?: string };
}

let entries: Entry[] = [];

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminToken: string;
let token: string;
let customerId: string;
let addressId: string;
let productId: string;
let variantId: string;
let methodId: string;

async function registerAndLogin(email: string) {
  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data;
}

const named = (message: string) => entries.filter((entry) => entry.message === message);

const forRequest = (response: { headers: Record<string, string> }) =>
  entries.filter((entry) => entry.context.requestId === response.headers['x-request-id']);

async function checkout(paymentMethod = 'cod', expectedTotalCents = total) {
  await api()
    .post('/api/cart/items')
    .set(bearer(token))
    .send({ variantId, quantity: 1 })
    .expect(200);

  return api().post('/api/orders').set(bearer(token)).send({
    addressId,
    paymentMethod,
    expectedTotalCents,
    idempotencyKey: randomUUID(),
  });
}

function guestCheckout() {
  return api()
    .post('/api/orders/guest')
    .send({
      email: 'guest-person@example.com',
      address,
      items: [{ variantId, quantity: 1 }],
      paymentMethod: methodId,
      expectedTotalCents: total,
      idempotencyKey: randomUUID(),
    });
}

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions, login_attempts cascade`);

  adminToken = (await registerAndLogin(adminEmail)).accessToken;
  await db.update(users).set({ roleId: SUPER_ADMIN_ROLE_ID }).where(eq(users.email, adminEmail));

  const customer = await registerAndLogin(customerEmail);
  token = customer.accessToken;
  customerId = customer.user.id;
});

beforeEach(async () => {
  await db.execute(
    sql`truncate table categories, products, addresses, orders, payment_methods cascade`,
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
  productId = product.id;

  const [variant] = await db
    .insert(productVariants)
    .values({ productId, priceCents: 112000, stock: 10 })
    .returning();
  if (!variant) throw new Error('Failed to insert variant');
  variantId = variant.id;

  const [method] = await db
    .insert(paymentMethods)
    .values({ providerName: 'GCash', accountName: 'Owner', accountNumber: '09171112222' })
    .returning();
  if (!method) throw new Error('Failed to insert method');
  methodId = method.id;

  addressId = (await api().post('/api/addresses').set(bearer(token)).send(address).expect(201)).body
    .data.id;

  entries = [];

  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(logger, level).mockImplementation(((
      first: Record<string, unknown> | string,
      second?: string,
    ) => {
      entries.push({
        level,
        fields: typeof first === 'string' ? {} : first,
        message: typeof first === 'string' ? first : (second ?? ''),
        context: logContext(),
      });
    }) as never);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  env.UPLOADS_DIR = process.env.UPLOADS_DIR ?? 'uploads';
});

afterAll(async () => {
  await pool.end();
});

describe('the request log', () => {
  it('records each request', async () => {
    await api().get('/api/categories?page=2').expect(200);

    const [entry] = named('Request completed');

    expect(entry?.fields).toMatchObject({ method: 'GET', path: '/api/categories', status: 200 });
    expect(entry?.fields.durationMs).toEqual(expect.any(Number));
  });

  it('leaves out the query string', async () => {
    await api().get('/api/products?search=private-search-term').expect(200);

    expect(JSON.stringify(entries)).not.toContain('private-search-term');
  });

  it('skips the health check', async () => {
    await api().get('/health').expect(200);

    expect(named('Request completed')).toEqual([]);
  });

  it('records failed requests', async () => {
    await api().get('/api/orders').expect(401);

    expect(named('Request completed')[0]?.fields.status).toBe(401);
  });

  it('masks private guest links', async () => {
    const order = (await guestCheckout().expect(201)).body.data;

    await api().get(`/api/orders/guest/${order.guestToken}`).expect(200);
    await api()
      .post(`/api/orders/guest/${order.guestToken}/payment`)
      .send({ reference: 'REF-123456' })
      .expect(200);

    const paths = named('Request completed').map((entry) => entry.fields.path);

    expect(paths).toContain('/api/orders/guest/[hidden]');
    expect(paths).toContain('/api/orders/guest/[hidden]/payment');
    expect(JSON.stringify(entries)).not.toContain(order.guestToken);
  });
});

describe('tracking a request', () => {
  it('returns the request ID', async () => {
    const response = await api().get('/api/categories').expect(200);

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ignores a request ID sent by the client', async () => {
    const response = await api().get('/api/categories').set('X-Request-Id', 'fake-id').expect(200);

    expect(response.headers['x-request-id']).not.toBe('fake-id');
  });

  it('lets browsers read the request ID', async () => {
    const response = await api()
      .get('/api/categories')
      .set('Origin', 'http://localhost:5173')
      .expect(200);

    expect(response.headers['access-control-expose-headers']).toContain('X-Request-Id');
  });

  it('puts the same IDs on every line, through services and transactions', async () => {
    const response = await checkout();

    expect(response.status).toBe(201);

    const lines = forRequest(response);

    expect(lines.map((line) => line.message)).toEqual(
      expect.arrayContaining(['Order placed', 'Request completed']),
    );
    expect(lines.every((line) => line.context.userId === customerId)).toBe(true);
  });

  it('has no user ID on public requests', async () => {
    const response = await api().get('/api/categories').expect(200);

    expect(forRequest(response)[0]?.context.userId).toBeUndefined();
  });

  it('never mixes up parallel requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_value, index) =>
        index % 2 === 0
          ? api().get('/api/orders').set(bearer(token))
          : api().get('/api/categories'),
      ),
    );

    for (const response of responses) {
      const [line] = forRequest(response);
      const isOrders = response.request.url.includes('/api/orders');

      expect(line?.fields.path).toBe(isOrders ? '/api/orders' : '/api/categories');
      expect(line?.context.userId).toBe(isOrders ? customerId : undefined);
    }
  });

  it('keeps the IDs through a file upload', async () => {
    const response = await api()
      .post('/api/assets')
      .set(bearer(adminToken))
      .attach('file', png, 'photo.png')
      .expect(201);

    const [line] = named('File uploaded');

    expect(line?.context.requestId).toBe(response.headers['x-request-id']);
    expect(line?.context.userId).toBeDefined();
  });

  it('keeps the IDs through a large upload that arrives in pieces', async () => {
    const large = Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]);

    const response = await api()
      .post('/api/assets')
      .set(bearer(adminToken))
      .attach('file', large, 'photo.png')
      .expect(201);

    const [line] = named('File uploaded');

    expect(line?.context.requestId).toBe(response.headers['x-request-id']);
    expect(line?.context.userId).toBeDefined();
  });

  it('keeps the IDs on the request line when a client disconnects', async () => {
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    const socket = connect(port, '127.0.0.1');

    await new Promise<void>((resolve) => {
      socket.write(
        `POST /api/assets HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${adminToken}\r\nContent-Type: multipart/form-data; boundary=x\r\nContent-Length: 1000000\r\n\r\n--x\r\n`,
        () => resolve(),
      );
    });

    await vi.waitFor(() => expect(socket.bytesWritten).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 150));
    socket.destroy();

    await vi.waitFor(() => expect(named('Request completed')).toHaveLength(1));
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const [line] = named('Request completed');

    expect(line?.context.requestId).toBeDefined();
    expect(line?.context.userId).toBeDefined();
  });

  it('gives background jobs their own ID', async () => {
    const order = (await checkout(methodId)).body.data;
    await db.execute(sql`update orders set payment_due_at = now() - interval '1 hour'`);

    await runWithContext(() => expireUnpaidOrders());

    const [line] = named('Unpaid order expired');

    expect(line?.fields.orderId).toBe(order.id);
    expect(line?.context.requestId).toBeDefined();
    expect(line?.context.userId).toBeUndefined();
  });
});

describe('steps before an error', () => {
  it('shows how far a refused checkout got', async () => {
    const response = await checkout('cod', 1);

    expect(response.status).toBe(409);

    const [line] = forRequest(response).filter(({ level }) => level === 'warn');

    expect(line?.message).toBe('The order total has changed');
    expect(line?.fields.lastStep).toBe('Items checked');
    expect(line?.fields.steps).toEqual([
      'Authenticated',
      'Validated body',
      'Checkout started',
      'Address loaded',
      'Cart loaded',
      'Payment method checked',
      'Order limit checked',
      'Items checked',
    ]);
  });

  it('shows the last step when stock runs out', async () => {
    await api()
      .post('/api/cart/items')
      .set(bearer(token))
      .send({ variantId, quantity: 1 })
      .expect(200);
    await db.update(productVariants).set({ stock: 0 });

    const response = await api().post('/api/orders').set(bearer(token)).send({
      addressId,
      paymentMethod: 'cod',
      expectedTotalCents: total,
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(409);
    expect(forRequest(response).find(({ level }) => level === 'warn')?.fields.lastStep).toBe(
      'Total checked',
    );
  });

  it('shows the last step of an unexpected error', async () => {
    env.UPLOADS_DIR = 'package.json';

    const response = await api()
      .post('/api/assets')
      .set(bearer(adminToken))
      .attach('file', png, 'photo.png')
      .expect(500);

    const [line] = named('Unexpected error');

    expect(line?.level).toBe('error');
    expect(line?.fields.lastStep).toBe('File checked');
    expect(line?.context.requestId).toBe(response.headers['x-request-id']);
  });

  it('adds steps only to errors, not normal requests', async () => {
    await checkout();

    expect(JSON.stringify(named('Request completed'))).not.toContain('steps');
  });

  it('keeps steps separate between requests', async () => {
    await api().get('/api/categories').expect(200);
    const response = await api().get('/api/orders').expect(401);

    const line = forRequest(response).find(({ level }) => level === 'warn');

    expect(line?.fields.steps).toEqual([]);
  });

  it('keeps only the most recent steps', () => {
    runWithContext(() => {
      for (let index = 0; index < 40; index++) recordStep(`Step ${index}`);

      expect(recentSteps()).toHaveLength(30);
      expect(recentSteps().at(-1)).toBe('Step 39');
    });
  });

  it('does nothing outside a request', () => {
    recordStep('Nowhere');
    setUserId('nobody');

    expect(recentSteps()).toEqual([]);
    expect(logContext()).toEqual({});
  });
});

describe('errors', () => {
  it('logs expected errors as warnings, with the reason', async () => {
    await api().get('/api/orders').expect(401);

    expect(named('Missing access token')[0]).toMatchObject({
      level: 'warn',
      fields: { status: 401 },
    });
  });

  it('does not log what a customer typed into a failed validation', async () => {
    await api()
      .post('/api/auth/register')
      .send({ email: 'typed-value', password: 'typed-password-value' })
      .expect(400);

    expect(named('Validation failed')).toHaveLength(1);
    expect(named('Validation failed')[0]?.fields).not.toHaveProperty('details');
    expect(JSON.stringify(entries)).not.toContain('typed-');
  });

  it('gives customers the request ID on a 500, and nothing internal', async () => {
    env.UPLOADS_DIR = 'package.json';

    const response = await api()
      .post('/api/assets')
      .set(bearer(adminToken))
      .attach('file', png, 'photo.png')
      .expect(500);

    expect(response.body).toEqual({
      error: {
        message: 'Internal server error',
        requestId: response.headers['x-request-id'],
      },
    });
  });
});

describe('payments', () => {
  const pay = async (id: string) =>
    api()
      .post(`/api/orders/${id}/payment`)
      .set(bearer(token))
      .send({ reference: 'SECRETREF-1' })
      .expect(200);

  const admin = (id: string, action: string) =>
    api().post(`/api/orders/admin/${id}/payment/${action}`).set(bearer(adminToken));

  const setStatus = (id: string, status: string) =>
    api().patch(`/api/orders/admin/${id}/status`).set(bearer(adminToken)).send({ status });

  it('logs placing, submitting and confirming, without the reference', async () => {
    const order = (await checkout(methodId)).body.data;

    await pay(order.id);
    await admin(order.id, 'confirm').expect(200);

    expect(named('Order placed')[0]?.fields).toMatchObject({
      orderId: order.id,
      paymentType: 'manual',
      paymentProvider: 'GCash',
      totalCents: total,
    });
    expect(named('Payment reference submitted')[0]?.fields.orderId).toBe(order.id);
    expect(named('Payment confirmed')[0]?.fields.orderId).toBe(order.id);
    expect(named('Order paid')[0]?.fields.orderId).toBe(order.id);
    expect(JSON.stringify(entries)).not.toContain('SECRETREF');
  });

  it('logs a rejected payment and returned stock', async () => {
    const order = (await checkout(methodId)).body.data;

    await pay(order.id);
    await admin(order.id, 'reject').expect(200);

    expect(named('Payment rejected')).toHaveLength(1);
    expect(named('Stock returned')[0]?.fields).toMatchObject({
      orderId: order.id,
      items: [{ variantId, quantity: 1 }],
    });
  });

  it('logs a refund, and a COD order paid on delivery', async () => {
    const order = (await checkout()).body.data;

    await setStatus(order.id, 'confirmed').expect(200);
    await setStatus(order.id, 'shipped').expect(200);
    await setStatus(order.id, 'delivered').expect(200);
    await admin(order.id, 'refund').expect(200);

    expect(named('Order paid')).toHaveLength(1);
    expect(named('Refund recorded')).toHaveLength(1);
  });

  it('logs each status change with who made it', async () => {
    const order = (await checkout()).body.data;
    const [adminUser] = await db.select().from(users).where(eq(users.email, adminEmail));

    await setStatus(order.id, 'confirmed').expect(200);

    const [line] = named('Order status changed');

    expect(line?.fields).toMatchObject({ orderId: order.id, from: 'pending', to: 'confirmed' });
    expect(line?.context.userId).toBe(adminUser?.id);
  });

  it('logs a duplicate reference as a warning', async () => {
    const first = (await checkout(methodId)).body.data;
    const second = (await checkout(methodId)).body.data;

    await pay(first.id);
    await api()
      .post(`/api/orders/${second.id}/payment`)
      .set(bearer(token))
      .send({ reference: 'SECRETREF-1' })
      .expect(409);

    expect(named('This payment reference has already been used')[0]?.level).toBe('warn');
  });

  it('logs payment method changes without the account details', async () => {
    const response = await api()
      .patch(`/api/payment-methods/${methodId}`)
      .set(bearer(adminToken))
      .send({ accountNumber: '09998887777', accountName: 'New Owner' })
      .expect(200);

    const [line] = named('Payment method changed');

    expect(response.body.data.accountNumber).toBe('09998887777');
    expect(line?.fields).toMatchObject({ paymentMethodId: methodId });
    expect(line?.fields.fields).toEqual(['accountNumber', 'accountName']);
    expect(JSON.stringify(entries)).not.toContain('09998887777');
    expect(JSON.stringify(entries)).not.toContain('New Owner');
  });
});

describe('special processes', () => {
  it('logs manual stock and price changes', async () => {
    await api()
      .patch(`/api/products/${productId}/variants/${variantId}`)
      .set(bearer(adminToken))
      .send({ stock: 25, priceCents: 5000 })
      .expect(200);

    expect(named('Variant changed')[0]?.fields).toMatchObject({
      variantId,
      changes: { stock: 25, priceCents: 5000 },
    });
  });

  it('logs a refresh token being reused', async () => {
    const login = await api()
      .post('/api/auth/login')
      .send({ email: customerEmail, password, client: 'native' })
      .expect(200);
    const first = login.body.data.refreshToken;
    const second = await api().post('/api/auth/refresh').send({ refreshToken: first }).expect(200);
    await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: second.body.data.refreshToken })
      .expect(200);

    await api().post('/api/auth/refresh').send({ refreshToken: first }).expect(401);

    expect(named('Refresh token reused, session revoked')[0]?.level).toBe('warn');
  });

  it('logs a forged guest link', async () => {
    await api().get(`/api/orders/guest/${randomUUID()}.forged`).expect(404);

    expect(named('Guest link refused')[0]?.level).toBe('warn');
  });

  it('logs rate limits being hit', async () => {
    const attempts = Array.from({ length: 11 }, () => api().post('/api/orders/guest').send({}));
    await Promise.all(attempts);

    expect(named('Rate limit exceeded').length).toBeGreaterThan(0);
  });
});

describe('private data', () => {
  it('stays out of the logs through a full journey', async () => {
    const email = 'journey-person@example.com';
    await api().post('/api/auth/register').send({ email, password }).expect(201);
    const login = await api()
      .post('/api/auth/login')
      .send({ email, password, client: 'native' })
      .expect(200);
    const { accessToken, refreshToken } = login.body.data;
    await api().post('/api/auth/refresh').send({ refreshToken }).expect(200);
    await api().post('/api/addresses').set(bearer(accessToken)).send(address).expect(201);
    const guest = (await guestCheckout().expect(201)).body.data;

    const logged = JSON.stringify(entries);

    for (const secret of [
      password,
      email,
      accessToken,
      refreshToken,
      guest.guestToken,
      'guest-person@example.com',
      '+639171234567',
      '123 Rizal Street',
      'Juan Dela Cruz',
      '09171112222',
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe('the logger', () => {
  const capture = () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });

    return { lines, destination };
  };

  it('adds the IDs to each line by itself', () => {
    const { lines, destination } = capture();
    const output = createLogger(destination);
    const previousLevel = output.level;
    output.level = 'info';

    runWithContext(() => {
      setUserId('user-1');
      output.info('Something happened');
    });

    const line = JSON.parse(lines[0] ?? '{}');

    expect(line).toMatchObject({ userId: 'user-1', msg: 'Something happened' });
    expect(line.requestId).toEqual(expect.any(String));
    output.level = previousLevel;
  });

  it('names the environment on each line', () => {
    const { lines, destination } = capture();
    const output = createLogger(destination);
    output.level = 'info';

    output.info('Something happened');

    expect(JSON.parse(lines[0] ?? '{}').env).toBe('development');
  });

  it('hides sensitive fields, even if passed by mistake', () => {
    const { lines, destination } = capture();
    const output = createLogger(destination);
    output.level = 'info';

    output.info({ password: 'a', refreshToken: 'b', token: 'c', guestToken: 'd' }, 'Oops');

    const line = JSON.parse(lines[0] ?? '{}');

    expect(line).toMatchObject({
      password: '[hidden]',
      refreshToken: '[hidden]',
      token: '[hidden]',
      guestToken: '[hidden]',
    });
  });
});
