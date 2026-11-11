import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import {
  auditLogs,
  categories,
  products,
  productVariants,
  roles,
  SUPER_ADMIN_ROLE_ID,
  users,
} from '../src/db/schema';
import { credentialsLimiter } from '../src/modules/auth/auth.routes';
import { allPermissions } from '../src/modules/roles/permissions';

const password = 'correct-horse-battery';
const BUILT_IN_ROLES = ['Super admin', 'Admin', 'Staff'];

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Account {
  id: string;
  token: string;
}

let superAdmin: Account;
let admin: Account;
let staff: Account;
let customer: Account;
let productId: string;
let variantId: string;

async function roleId(name: string) {
  const [role] = await db.select().from(roles).where(eq(roles.name, name));
  if (!role) throw new Error(`Failed to find role ${name}`);
  return role.id;
}

async function createAccount(email: string, role: string | null): Promise<Account> {
  // Each account registers and logs in, which would otherwise hit the rate limit.
  for (const key of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
    await credentialsLimiter.resetKey(key);
  }

  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const [user] = await db
    .update(users)
    .set({ roleId: role })
    .where(eq(users.email, email))
    .returning();
  if (!user) throw new Error(`Failed to find ${email}`);

  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return { id: user.id, token: response.body.data.accessToken as string };
}

const asUser = (account: Account) => ({
  get: (path: string) => api().get(path).set(bearer(account.token)),
  post: (path: string, body: object = {}) => api().post(path).set(bearer(account.token)).send(body),
  patch: (path: string, body: object) => api().patch(path).set(bearer(account.token)).send(body),
  delete: (path: string) => api().delete(path).set(bearer(account.token)),
});

const deleteTestRoles = () => db.delete(roles).where(notInArray(roles.name, BUILT_IN_ROLES));

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions, categories, audit_logs cascade`);
  await deleteTestRoles();

  superAdmin = await createAccount('super@example.com', SUPER_ADMIN_ROLE_ID);
  admin = await createAccount('admin@example.com', await roleId('Admin'));
  staff = await createAccount('staff@example.com', await roleId('Staff'));
  customer = await createAccount('customer@example.com', null);

  const [category] = await db.insert(categories).values({ name: 'Clothing' }).returning();
  if (!category) throw new Error('Failed to insert category');

  const [product] = await db
    .insert(products)
    .values({ categoryId: category.id, name: 'Classic T-Shirt' })
    .returning();
  if (!product) throw new Error('Failed to insert product');
  productId = product.id;

  const [variant] = await db
    .insert(productVariants)
    .values({ productId, priceCents: 4500, stock: 3 })
    .returning();
  if (!variant) throw new Error('Failed to insert variant');
  variantId = variant.id;
});

afterAll(async () => {
  await db.execute(sql`truncate table users cascade`);
  await deleteTestRoles();
  await pool.end();
});

describe('permission checks on routes', () => {
  it('lets staff run orders and stock, but not prices, refunds, or sales', async () => {
    const asStaff = asUser(staff);
    const variantPath = `/api/products/${productId}/variants/${variantId}`;

    await asStaff.get('/api/orders/admin').expect(200);
    await asStaff.get('/api/products/admin').expect(200);
    await asStaff.get('/api/reports/low-stock').expect(200);
    await asStaff.patch(variantPath, { stock: 10 }).expect(200);

    await asStaff.patch(variantPath, { priceCents: 100 }).expect(403);
    await asStaff.patch(variantPath, { stock: 5, priceCents: 100 }).expect(403);
    await asStaff.patch(`/api/products/${productId}`, { name: 'Cheap Shirt' }).expect(403);
    await asStaff.get('/api/reports/summary').expect(403);
    await asStaff.get('/api/payment-methods/admin').expect(403);
    await asStaff.get('/api/audit-logs').expect(403);

    const [variant] = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, variantId));
    expect(variant).toMatchObject({ stock: 10, priceCents: 4500 });
  });

  it('lets admins run the store, but not manage roles', async () => {
    const asAdmin = asUser(admin);

    await asAdmin.get('/api/reports/summary').expect(200);
    await asAdmin.get('/api/audit-logs').expect(200);
    await asAdmin
      .patch(`/api/products/${productId}/variants/${variantId}`, { priceCents: 3900 })
      .expect(200);

    await asAdmin.get('/api/roles').expect(403);
    await asAdmin.patch(`/api/users/${customer.id}/role`, { roleId: null }).expect(403);
  });

  it('keeps customers out of admin routes', async () => {
    await asUser(customer).get('/api/orders/admin').expect(403);
    await asUser(customer).get('/api/roles').expect(403);
    await api().get('/api/roles').expect(401);
  });
});

describe('roles', () => {
  it('lists every permission with a description', async () => {
    const response = await asUser(superAdmin).get('/api/roles/permissions').expect(200);

    expect(response.body.data.map((item: { key: string }) => item.key)).toEqual(allPermissions);
    expect(response.body.data[0].description).toEqual(expect.any(String));
  });

  it('lists the built-in roles, with Super admin holding every permission', async () => {
    const response = await asUser(superAdmin).get('/api/roles').expect(200);
    const byName = Object.fromEntries(
      response.body.data.map((role: { name: string }) => [role.name, role]),
    );

    expect(byName['Super admin']).toMatchObject({
      builtIn: true,
      permissions: allPermissions,
      userCount: 1,
    });
    expect(byName.Staff).toMatchObject({ builtIn: false, userCount: 1 });
    expect(byName.Staff.permissions).toContain('inventory.manage');
    expect(byName.Staff.permissions).not.toContain('products.manage');
  });

  it('creates a role that grants exactly its permissions', async () => {
    const created = await asUser(superAdmin)
      .post('/api/roles', {
        name: 'Content Editor',
        description: 'Writes blogs',
        permissions: ['blogs.manage', 'assets.manage'],
      })
      .expect(201);

    expect(created.body.data).toMatchObject({
      name: 'Content Editor',
      builtIn: false,
      permissions: ['blogs.manage', 'assets.manage'],
    });

    const editor = await createAccount('editor@example.com', created.body.data.id);
    const asEditor = asUser(editor);

    await asEditor.post('/api/blogs', { title: 'Hello', content: 'Hi', author: 'Ed' }).expect(201);
    await asEditor.get('/api/orders/admin').expect(403);
  });

  it('rejects unknown permissions and duplicate names', async () => {
    const asSuper = asUser(superAdmin);

    await asSuper.post('/api/roles', { name: 'Odd', permissions: ['roles.manage'] }).expect(400);
    await asSuper.post('/api/roles', { name: 'staff', permissions: [] }).expect(409);
  });

  it('applies permission changes on the very next request, and audits them', async () => {
    const asSuper = asUser(superAdmin);
    const created = await asSuper
      .post('/api/roles', { name: 'Packer', permissions: ['orders.view'] })
      .expect(201);
    const packerRoleId = created.body.data.id as string;
    const packer = await createAccount('packer@example.com', packerRoleId);

    await asUser(packer).get('/api/orders/admin').expect(200);

    await asSuper
      .patch(`/api/roles/${packerRoleId}`, { permissions: ['inventory.manage'] })
      .expect(200);

    await asUser(packer).get('/api/orders/admin').expect(403);

    const [entry] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, packerRoleId), eq(auditLogs.action, 'update')));
    expect(entry).toMatchObject({
      actorUserId: superAdmin.id,
      changes: { permissions: [['orders.view'], ['inventory.manage']] },
    });
  });

  it('never changes or deletes the Super admin role', async () => {
    const path = `/api/roles/${SUPER_ADMIN_ROLE_ID}`;

    await asUser(superAdmin).patch(path, { name: 'Owner' }).expect(409);
    await asUser(superAdmin).delete(path).expect(409);
  });

  it('deletes a role only once no user has it', async () => {
    const asSuper = asUser(superAdmin);
    const created = await asSuper
      .post('/api/roles', { name: 'Temporary', permissions: [] })
      .expect(201);
    const temporary = await createAccount('temp@example.com', created.body.data.id);
    const path = `/api/roles/${created.body.data.id}`;

    await asSuper.delete(path).expect(409);

    await asSuper.patch(`/api/users/${temporary.id}/role`, { roleId: null }).expect(200);
    await asSuper.delete(path).expect(204);
    await asSuper.get(path).expect(404);
  });
});

describe('PATCH /api/users/:id/role', () => {
  it('changes a role and records it by name', async () => {
    const response = await asUser(superAdmin)
      .patch(`/api/users/${customer.id}/role`, { roleId: await roleId('Staff') })
      .expect(200);

    expect(response.body.data).toMatchObject({ role: { name: 'Staff' } });
    expect(response.body.data.permissions).toContain('orders.view');

    const [entry] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, customer.id), eq(auditLogs.action, 'role_change')));
    expect(entry).toMatchObject({ actorUserId: superAdmin.id, changes: { role: [null, 'Staff'] } });

    await asUser(superAdmin).patch(`/api/users/${customer.id}/role`, { roleId: null }).expect(200);
  });

  it('rejects changing your own role, unknown roles, and unknown users', async () => {
    const asSuper = asUser(superAdmin);

    await asSuper.patch(`/api/users/${superAdmin.id}/role`, { roleId: null }).expect(409);
    await asSuper
      .patch(`/api/users/${customer.id}/role`, { roleId: '00000000-0000-4000-8000-000000000999' })
      .expect(400);
    await asSuper
      .patch('/api/users/00000000-0000-4000-8000-000000000999/role', { roleId: null })
      .expect(404);
  });

  it('never leaves the store without a super admin', async () => {
    const other = await createAccount('super2@example.com', SUPER_ADMIN_ROLE_ID);

    // Two super admins remove each other at the same moment. Only one can win.
    const results = await Promise.all([
      asUser(superAdmin).patch(`/api/users/${other.id}/role`, { roleId: null }),
      asUser(other).patch(`/api/users/${superAdmin.id}/role`, { roleId: null }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 403]);

    const remaining = await db
      .select()
      .from(users)
      .where(
        and(eq(users.roleId, SUPER_ADMIN_ROLE_ID), inArray(users.id, [superAdmin.id, other.id])),
      );
    expect(remaining).toHaveLength(1);

    // Restores the first super admin for any later test.
    if (remaining[0]?.id !== superAdmin.id) {
      await db
        .update(users)
        .set({ roleId: SUPER_ADMIN_ROLE_ID })
        .where(eq(users.id, superAdmin.id));
    }
  });
});
