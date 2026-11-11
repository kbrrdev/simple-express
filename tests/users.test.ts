import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import { roles, SUPER_ADMIN_ROLE_ID, users } from '../src/db/schema';
import { credentialsLimiter } from '../src/modules/auth/auth.routes';

const password = 'correct-horse-battery';

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let superAdminToken: string;
let adminToken: string;
let staffToken: string;
let customerToken: string;
let staffRoleId: string;

async function roleId(name: string) {
  const [role] = await db.select().from(roles).where(eq(roles.name, name));
  if (!role) throw new Error(`Failed to find role ${name}`);
  return role.id;
}

/** Registers a user with the role, and logs in when asked. */
async function createUser(email: string, role: string | null) {
  for (const key of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
    await credentialsLimiter.resetKey(key);
  }

  await api().post('/api/auth/register').send({ email, password }).expect(201);
  await db.update(users).set({ roleId: role }).where(eq(users.email, email));

  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

const listUsers = (query: object = {}, token = superAdminToken) =>
  api().get('/api/users').query(query).set(bearer(token));

const emailsOf = (response: request.Response) =>
  response.body.data.map((user: { email: string }) => user.email);

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  staffRoleId = await roleId('Staff');
  superAdminToken = await createUser('owner@example.com', SUPER_ADMIN_ROLE_ID);
  adminToken = await createUser('manager@example.com', await roleId('Admin'));
  staffToken = await createUser('packer@example.com', staffRoleId);
  customerToken = await createUser('jane@example.com', null);
  await createUser('juan_dela_cruz@example.com', null);
  await createUser('juanadelacruz@example.com', null);
});

afterAll(async () => {
  await db.execute(sql`truncate table users cascade`);
  await pool.end();
});

describe('GET /api/users', () => {
  it('is for super admins only', async () => {
    await api().get('/api/users').expect(401);
    await listUsers({}, customerToken).expect(403);
    await listUsers({}, staffToken).expect(403);
    await listUsers({}, adminToken).expect(403);
  });

  it('lists users newest first, with their role', async () => {
    const response = await listUsers().expect(200);

    expect(response.body.meta).toEqual({ page: 1, limit: 20, total: 6 });
    expect(emailsOf(response)[0]).toBe('juanadelacruz@example.com');

    const packer = response.body.data.find(
      (user: { email: string }) => user.email === 'packer@example.com',
    );
    expect(packer).toEqual({
      id: expect.any(String),
      email: 'packer@example.com',
      role: { id: staffRoleId, name: 'Staff' },
      createdAt: expect.any(String),
    });
  });

  it('searches part of the email, ignoring case', async () => {
    const response = await listUsers({ search: 'JUAN' }).expect(200);

    expect(emailsOf(response).sort()).toEqual([
      'juan_dela_cruz@example.com',
      'juanadelacruz@example.com',
    ]);
  });

  it('matches % and _ literally', async () => {
    expect(emailsOf(await listUsers({ search: 'juan_' }).expect(200))).toEqual([
      'juan_dela_cruz@example.com',
    ]);
    expect(emailsOf(await listUsers({ search: '%' }).expect(200))).toEqual([]);
  });

  it('lists staff, customers, or one role', async () => {
    const staff = await listUsers({ type: 'staff' }).expect(200);
    expect(emailsOf(staff).sort()).toEqual([
      'manager@example.com',
      'owner@example.com',
      'packer@example.com',
    ]);

    const customers = await listUsers({ type: 'customer', search: 'juan' }).expect(200);
    expect(emailsOf(customers).sort()).toEqual([
      'juan_dela_cruz@example.com',
      'juanadelacruz@example.com',
    ]);
    expect(customers.body.data.every((user: { role: null }) => user.role === null)).toBe(true);

    expect(emailsOf(await listUsers({ roleId: staffRoleId }).expect(200))).toEqual([
      'packer@example.com',
    ]);

    await listUsers({ type: 'admin' }).expect(400);
    await listUsers({ roleId: 'customer' }).expect(400);
  });

  it('pages through the results', async () => {
    const first = await listUsers({ limit: 4 }).expect(200);
    const second = await listUsers({ limit: 4, page: 2 }).expect(200);

    expect(first.body.data).toHaveLength(4);
    expect(second.body.data).toHaveLength(2);
    expect(second.body.meta).toEqual({ page: 2, limit: 4, total: 6 });
  });
});

describe('superAdmin on the current user', () => {
  it('is true only for super admins, even though Admin has every permission', async () => {
    const me = async (token: string) =>
      (await api().get('/api/auth/me').set(bearer(token)).expect(200)).body.data;

    const owner = await me(superAdminToken);
    const manager = await me(adminToken);

    expect(owner.superAdmin).toBe(true);
    expect(manager.superAdmin).toBe(false);
    expect(manager.permissions).toEqual(owner.permissions);
    expect((await me(staffToken)).superAdmin).toBe(false);
    expect((await me(customerToken)).superAdmin).toBe(false);
  });
});
