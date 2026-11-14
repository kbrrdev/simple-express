import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import { auditLogs, roles, STORE_INFO_ID, users } from '../src/db/schema';

const password = 'correct-horse-battery';
const url = '/api/store-info';

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminRoleToken: string;
let customerToken: string;

async function registerAndLogin(email: string) {
  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

const save = (body: object, token = adminRoleToken) => api().put(url).set(bearer(token)).send(body);

const fullInfo = {
  name: 'Simple Store',
  email: 'Hello@Example.com',
  phone: '(02) 8123 4567',
  line1: '123 Rizal Street',
  line2: 'Unit 4B',
  barangay: 'Poblacion',
  city: 'Makati',
  province: 'Metro Manila',
  postalCode: '1210',
  businessHours: 'Mon to Sat, 9am to 6pm',
  socialLinks: [
    { platform: 'instagram', url: 'https://instagram.com/simple' },
    { platform: 'facebook', url: 'https://facebook.com/simple', label: 'Outlet' },
  ],
};

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  // The built-in Admin role, which the migration grants store.manage.
  const [adminRole] = await db.select().from(roles).where(eq(roles.name, 'Admin'));
  adminRoleToken = await registerAndLogin('store-admin@example.com');
  await db
    .update(users)
    .set({ roleId: adminRole?.id })
    .where(eq(users.email, 'store-admin@example.com'));

  customerToken = await registerAndLogin('customer@example.com');
});

afterAll(async () => {
  await save({ name: 'My Store' }).expect(200);
  await db.execute(sql`truncate table users, sessions cascade`);
  await pool.end();
});

describe('store info', () => {
  it('saves the whole form and shows it publicly', async () => {
    await save(fullInfo).expect(200);

    const response = await api().get(url).expect(200);

    expect(response.body.data).toEqual({
      ...fullInfo,
      email: 'hello@example.com',
      socialLinks: [
        { platform: 'instagram', url: 'https://instagram.com/simple', label: null },
        { platform: 'facebook', url: 'https://facebook.com/simple', label: 'Outlet' },
      ],
      updatedAt: expect.any(String),
    });
  });

  it('clears omitted fields, as the form is saved whole', async () => {
    await save(fullInfo).expect(200);
    const response = await save({ name: 'Renamed Store' }).expect(200);

    expect(response.body.data).toMatchObject({
      name: 'Renamed Store',
      email: null,
      phone: null,
      line1: null,
      postalCode: null,
      socialLinks: [],
    });
  });

  it('records changed fields in the audit log', async () => {
    await save({ name: 'Before' }).expect(200);
    await save({ name: 'After', city: 'Pasig' }).expect(200);

    const [entry] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'store_info'), eq(auditLogs.entityId, STORE_INFO_ID)))
      .orderBy(sql`${auditLogs.createdAt} desc`)
      .limit(1);

    expect(entry?.changes).toEqual({ name: ['Before', 'After'], city: [null, 'Pasig'] });
  });

  it('rejects unsafe links, unknown platforms, and too many links', async () => {
    const link = (platform: string, url: string) => ({
      name: 'Store',
      socialLinks: [{ platform, url }],
    });

    await save(link('facebook', 'javascript:alert(1)')).expect(400);
    await save(link('facebook', 'http://facebook.com/simple')).expect(400);
    await save(link('myspace', 'https://myspace.com/simple')).expect(400);
    await save({
      name: 'Store',
      socialLinks: Array.from({ length: 11 }, () => ({
        platform: 'facebook',
        url: 'https://facebook.com/simple',
      })),
    }).expect(400);
    await save({ email: 'hello@example.com' }).expect(400);
  });

  it('needs store.manage to save', async () => {
    await api().put(url).send({ name: 'Store' }).expect(401);
    await save({ name: 'Store' }, customerToken).expect(403);
  });
});
