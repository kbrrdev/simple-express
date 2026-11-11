import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import { auditLogs, categories, orders, SUPER_ADMIN_ROLE_ID, users } from '../src/db/schema';

const password = 'correct-horse-battery';

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminToken: string;
let adminId: string;
let customerToken: string;
let categoryId: string;

async function registerAndLogin(email: string) {
  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

const getLogs = (query: object = {}) =>
  api().get('/api/audit-logs').query(query).set(bearer(adminToken));

function entriesFor(entityId: string) {
  return db.select().from(auditLogs).where(eq(auditLogs.entityId, entityId));
}

/** Runs a script as `npm run` would. */
function runScript(script: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

beforeAll(async () => {
  await db.execute(
    sql`truncate table audit_logs, users, sessions, categories, orders, payment_methods cascade`,
  );

  adminToken = await registerAndLogin('admin@example.com');
  const [admin] = await db
    .update(users)
    .set({ roleId: SUPER_ADMIN_ROLE_ID })
    .where(eq(users.email, 'admin@example.com'))
    .returning();
  if (!admin) throw new Error('Failed to find admin');
  adminId = admin.id;

  customerToken = await registerAndLogin('customer@example.com');

  const [category] = await db.insert(categories).values({ name: 'Clothing' }).returning();
  if (!category) throw new Error('Failed to insert category');
  categoryId = category.id;
});

afterAll(async () => {
  await pool.end();
});

describe('GET /api/audit-logs', () => {
  it('requires an admin', async () => {
    await api().get('/api/audit-logs').expect(401);
    await api().get('/api/audit-logs').set(bearer(customerToken)).expect(403);
  });

  it('rejects bad filters', async () => {
    await getLogs({ entityType: 'cart' }).expect(400);
    await getLogs({ from: '2026-02-30' }).expect(400);
    await getLogs({ from: '2026-03-02', to: '2026-03-01' }).expect(400);
  });
});

describe('recording changes', () => {
  it('records who changed a variant, with the values before and after', async () => {
    const created = await api()
      .post('/api/products')
      .set(bearer(adminToken))
      .send({ categoryId, name: 'Classic T-Shirt', variants: [{ priceCents: 4500, stock: 3 }] })
      .expect(201);
    const productId = created.body.data.id as string;
    const variantId = created.body.data.variants[0].id as string;

    await api()
      .patch(`/api/products/${productId}/variants/${variantId}`)
      .set(bearer(adminToken))
      .send({ priceCents: 3900, stock: 3 })
      .expect(200);

    const response = await getLogs({ entityType: 'variant', entityId: variantId }).expect(200);

    expect(response.body.meta.total).toBe(2);
    const [update, create] = response.body.data;

    expect(update).toMatchObject({
      actorUserId: adminId,
      actorEmail: 'admin@example.com',
      entityType: 'variant',
      entityId: variantId,
      action: 'update',
      // Stock was sent unchanged, so only the price is recorded.
      changes: { priceCents: [4500, 3900] },
    });
    expect(update.requestId).toEqual(expect.any(String));
    expect(create).toMatchObject({ action: 'create', changes: { priceCents: [null, 4500] } });

    const [product] = await entriesFor(productId);
    expect(product).toMatchObject({ action: 'create', entityType: 'product' });
  });

  it('records nothing when the change fails', async () => {
    const created = await api()
      .post('/api/products')
      .set(bearer(adminToken))
      .send({ categoryId, name: 'Plain Mug', variants: [{ priceCents: 900 }] })
      .expect(201);
    const productId = created.body.data.id as string;

    await api()
      .patch(`/api/products/${productId}`)
      .set(bearer(adminToken))
      .send({ name: 'Large Mug', option1Name: 'Size' })
      .expect(409);

    // Products still use the category, so it cannot be deleted.
    await api().delete(`/api/categories/${categoryId}`).set(bearer(adminToken)).expect(409);

    expect((await entriesFor(productId)).map((entry) => entry.action)).toEqual(['create']);
    expect(await entriesFor(categoryId)).toEqual([]);
  });

  it('hides payment account numbers', async () => {
    const created = await api()
      .post('/api/payment-methods')
      .set(bearer(adminToken))
      .send({ providerName: 'GCash', accountName: 'Juan Dela Cruz', accountNumber: '09171234567' })
      .expect(201);
    const methodId = created.body.data.id as string;

    await api()
      .patch(`/api/payment-methods/${methodId}`)
      .set(bearer(adminToken))
      .send({ accountNumber: '09187654321', enabled: false })
      .expect(200);

    const entries = await entriesFor(methodId);
    const update = entries.find((entry) => entry.action === 'update');

    expect(update?.changes).toEqual({
      accountNumber: ['[redacted]', '[redacted]'],
      enabled: [true, false],
    });
    expect(JSON.stringify(entries)).not.toContain('0917');
  });

  it('records order status changes', async () => {
    const [order] = await db
      .insert(orders)
      .values({
        guestEmail: 'guest@example.com',
        idempotencyKey: randomUUID(),
        status: 'pending',
        paymentType: 'cod',
        subtotalCents: 4500,
        shippingCents: 1000,
        taxCents: 589,
        totalCents: 5500,
        taxRateBasisPoints: 1200,
        pricesIncludeTax: true,
        recipientName: 'Juan Dela Cruz',
        phone: '+639171234567',
        line1: '123 Rizal Street',
        line2: '',
        barangay: 'San Antonio',
        city: 'Pasig',
        province: 'Metro Manila',
        postalCode: '1605',
      })
      .returning();
    if (!order) throw new Error('Failed to insert order');

    await api()
      .patch(`/api/orders/admin/${order.id}/status`)
      .set(bearer(adminToken))
      .send({ status: 'cancelled' })
      .expect(200);

    const [entry] = await entriesFor(order.id);
    expect(entry).toMatchObject({
      actorUserId: adminId,
      action: 'status_change',
      changes: { status: ['pending', 'cancelled'] },
    });
  });

  it('records password changes and signing out everywhere for the user', async () => {
    const [customer] = await db.select().from(users).where(eq(users.email, 'customer@example.com'));
    if (!customer) throw new Error('Failed to find customer');

    await api()
      .post('/api/auth/change-password')
      .set(bearer(customerToken))
      .send({ currentPassword: password, newPassword: 'another-horse-battery' })
      .expect(204);
    await api().post('/api/auth/logout-all').set(bearer(customerToken)).expect(204);

    const entries = await entriesFor(customer.id);
    expect(entries.map((entry) => entry.action).sort()).toEqual([
      'password_change',
      'sessions_revoke',
    ]);
    expect(entries.every((entry) => entry.actorUserId === customer.id)).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('argon2');
  });

  it('records role changes made by the set-role script', async () => {
    await api()
      .post('/api/auth/register')
      .send({ email: 'staff@example.com', password })
      .expect(201);

    const result = runScript('src/db/set-role.ts', ['staff@example.com', 'staff']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    // Running it again changes nothing, so nothing more is recorded.
    expect(runScript('src/db/set-role.ts', ['staff@example.com', 'staff']).status).toBe(0);

    const [staff] = await db.select().from(users).where(eq(users.email, 'staff@example.com'));
    if (!staff) throw new Error('Failed to find staff');

    const entries = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, staff.id), eq(auditLogs.action, 'role_change')));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorUserId: null,
      changes: { role: [null, 'Staff'] },
    });
  }, 30000);
});

describe('database role', () => {
  it('lets the API add and read entries, but never change or delete them', async () => {
    const testUrl = process.env.DATABASE_URL;
    if (!testUrl) throw new Error('DATABASE_URL is not set');

    const appUrl = new URL(testUrl);
    appUrl.username = 'audit_test_app';
    appUrl.password = 'audit-test-password';

    const result = runScript('src/db/migrate.ts', [], {
      DATABASE_URL: appUrl.toString(),
      MIGRATION_DATABASE_URL: testUrl,
    });
    expect(result.status).toBe(0);

    const appPool = new Pool({ connectionString: appUrl.toString() });

    try {
      await appPool.query(
        `insert into audit_logs (entity_type, entity_id, action, changes) values ('user', $1, 'test', '{}')`,
        [randomUUID()],
      );
      await appPool.query('select * from audit_logs');

      await expect(appPool.query(`update audit_logs set action = 'edited'`)).rejects.toMatchObject({
        code: '42501',
      });
      await expect(appPool.query('delete from audit_logs')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await appPool.end();
    }
  }, 30000);
});
