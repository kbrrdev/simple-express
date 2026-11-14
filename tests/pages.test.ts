import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import { auditLogs, pages, roles, users } from '../src/db/schema';

const password = 'correct-horse-battery';
const missingId = '00000000-0000-4000-8000-000000000000';
const url = '/api/pages';

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

const asAdmin = {
  post: (path: string, body: object) => api().post(path).set(bearer(adminRoleToken)).send(body),
  patch: (path: string, body: object) => api().patch(path).set(bearer(adminRoleToken)).send(body),
  delete: (path: string) => api().delete(path).set(bearer(adminRoleToken)),
  get: (path: string) => api().get(path).set(bearer(adminRoleToken)),
};

async function createPage(body: object = {}) {
  const response = await asAdmin
    .post(url, { slug: 'terms', title: 'Terms', content: 'Be nice.', ...body })
    .expect(201);
  return response.body.data;
}

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  // The built-in Admin role, which the migration grants pages.manage.
  const [adminRole] = await db.select().from(roles).where(eq(roles.name, 'Admin'));
  adminRoleToken = await registerAndLogin('store-admin@example.com');
  await db
    .update(users)
    .set({ roleId: adminRole?.id })
    .where(eq(users.email, 'store-admin@example.com'));

  customerToken = await registerAndLogin('customer@example.com');
});

beforeEach(async () => {
  await db.delete(pages);
});

afterAll(async () => {
  await db.delete(pages);
  await db.execute(sql`truncate table users, sessions cascade`);
  await pool.end();
});

describe('pages', () => {
  it('hides drafts from the public, including by slug', async () => {
    await createPage({ slug: 'terms', title: 'Terms', published: true });
    await createPage({ slug: 'privacy', title: 'Privacy' });

    const list = await api().get(url).expect(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({ slug: 'terms', title: 'Terms', published: true }),
    ]);
    expect(list.body.data[0]).not.toHaveProperty('content');

    const page = await api().get(`${url}/terms`).expect(200);
    expect(page.body.data).toMatchObject({ slug: 'terms', content: 'Be nice.' });
    await api().get(`${url}/privacy`).expect(404);

    const adminList = await asAdmin.get(`${url}/admin`).expect(200);
    expect(adminList.body.data.map((item: { slug: string }) => item.slug)).toEqual([
      'privacy',
      'terms',
    ]);
  });

  it('updates, reads, and deletes a page by id, with audit entries', async () => {
    const page = await createPage();

    const updated = await asAdmin
      .patch(`${url}/admin/${page.id}`, { title: 'Terms of Use', published: true })
      .expect(200);
    expect(updated.body.data).toMatchObject({ title: 'Terms of Use', published: true });

    const draft = await asAdmin.get(`${url}/admin/${page.id}`).expect(200);
    expect(draft.body.data.content).toBe('Be nice.');

    await asAdmin.delete(`${url}/admin/${page.id}`).expect(204);
    await asAdmin.get(`${url}/admin/${page.id}`).expect(404);
    await asAdmin.delete(`${url}/admin/${missingId}`).expect(404);

    const entries = await db.select().from(auditLogs).where(eq(auditLogs.entityId, page.id));
    expect(entries.map((entry) => entry.action).sort()).toEqual(['create', 'delete', 'update']);
  });

  it('keeps slugs unique and URL-safe', async () => {
    const page = await createPage({ slug: 'Returns' });
    expect(page.slug).toBe('returns');

    await asAdmin.post(url, { slug: 'returns', title: 'Again', content: 'x' }).expect(409);
    await asAdmin.post(url, { slug: 'admin', title: 'Admin', content: 'x' }).expect(400);
    await asAdmin.post(url, { slug: 'a b', title: 'Spaces', content: 'x' }).expect(400);
    await asAdmin.post(url, { slug: '-terms', title: 'Dash', content: 'x' }).expect(400);
  });

  it('needs pages.manage to write or read drafts', async () => {
    const page = await createPage();

    await api().post(url).send({ slug: 'faq', title: 'FAQ', content: 'x' }).expect(401);
    await api().get(`${url}/admin`).set(bearer(customerToken)).expect(403);
    await api().get(`${url}/admin/${page.id}`).set(bearer(customerToken)).expect(403);
    await api()
      .patch(`${url}/admin/${page.id}`)
      .set(bearer(customerToken))
      .send({ title: 'Hacked' })
      .expect(403);
  });
});
