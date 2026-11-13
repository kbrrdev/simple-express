import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import { auditLogs, banners, roles, SUPER_ADMIN_ROLE_ID, users } from '../src/db/schema';
import { MAX_BANNERS } from '../src/modules/banners/banner.service';

const password = 'correct-horse-battery';
const missingId = '00000000-0000-4000-8000-000000000000';
const url = '/api/banners';
const hour = 60 * 60 * 1000;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminToken: string;
let adminRoleToken: string;
let customerToken: string;
let imageId: string;

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

async function uploadImage() {
  const response = await api()
    .post('/api/assets')
    .set(bearer(adminToken))
    .attach('file', png, 'banner.png')
    .expect(201);

  return response.body.data as { id: string; url: string };
}

async function createBanner(body: object = {}) {
  const response = await asAdmin
    .post(url, { assetId: imageId, altText: 'Holiday sale', ...body })
    .expect(201);
  return response.body.data;
}

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  adminToken = await registerAndLogin('admin@example.com');
  await db
    .update(users)
    .set({ roleId: SUPER_ADMIN_ROLE_ID })
    .where(eq(users.email, 'admin@example.com'));

  // The built-in Admin role, which the migration grants banners.manage.
  const [adminRole] = await db.select().from(roles).where(eq(roles.name, 'Admin'));
  adminRoleToken = await registerAndLogin('store-admin@example.com');
  await db
    .update(users)
    .set({ roleId: adminRole?.id })
    .where(eq(users.email, 'store-admin@example.com'));

  customerToken = await registerAndLogin('customer@example.com');
});

beforeEach(async () => {
  await db.execute(sql`truncate table banners, assets cascade`);
  imageId = (await uploadImage()).id;
});

afterAll(async () => {
  await pool.end();
});

describe('showing banners', () => {
  it('is public, and lists active banners in position order', async () => {
    const second = await createBanner({ altText: 'Second', position: 2 });
    const first = await createBanner({ altText: 'First', position: 1 });
    await createBanner({ altText: 'Off', isActive: false });

    const response = await api().get(url).expect(200);

    expect(response.body.data.map((banner: { id: string }) => banner.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(response.body.meta).toEqual({ page: 1, limit: 2, total: 2 });
  });

  it('only shows banners within their dates', async () => {
    const now = Date.now();
    const current = await createBanner({
      startsAt: new Date(now - hour).toISOString(),
      endsAt: new Date(now + hour).toISOString(),
    });
    await createBanner({ startsAt: new Date(now + hour).toISOString() });
    await createBanner({
      startsAt: new Date(now - 2 * hour).toISOString(),
      endsAt: new Date(now - hour).toISOString(),
    });

    const response = await api().get(url).expect(200);

    expect(response.body.data.map((banner: { id: string }) => banner.id)).toEqual([current.id]);
  });

  it('returns both image URLs, and null when there is no mobile image', async () => {
    const mobile = await uploadImage();
    const withMobile = await createBanner({ mobileAssetId: mobile.id, position: 0 });
    await createBanner({ position: 1 });

    const response = await api().get(url).expect(200);
    const [first, second] = response.body.data;

    expect(first).toMatchObject({
      id: withMobile.id,
      assetId: imageId,
      mobileAssetId: mobile.id,
      mobileImageUrl: mobile.url,
    });
    expect(first.imageUrl).toMatch(/^http/);
    expect(second).toMatchObject({ mobileAssetId: null, mobileImageUrl: null });
  });
});

describe('managing banners', () => {
  it('needs banners.manage', async () => {
    await api().get(`${url}/admin`).expect(401);
    await api().get(`${url}/admin`).set(bearer(customerToken)).expect(403);
    await api()
      .post(url)
      .set(bearer(customerToken))
      .send({ assetId: imageId, altText: 'Sale' })
      .expect(403);

    await api()
      .post(url)
      .set(bearer(adminRoleToken))
      .send({ assetId: imageId, altText: 'Sale' })
      .expect(201);
  });

  it('lists inactive and scheduled banners for admins', async () => {
    await createBanner({ isActive: false });
    await createBanner({ startsAt: new Date(Date.now() + hour).toISOString() });

    const response = await asAdmin.get(`${url}/admin`).expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.maxBanners).toBe(MAX_BANNERS);
  });

  it('creates a banner with every field', async () => {
    const mobile = await uploadImage();
    const startsAt = new Date(Date.now() - hour).toISOString();

    const banner = await createBanner({
      mobileAssetId: mobile.id,
      title: 'Holiday Sale',
      subtitle: 'Up to 30% off',
      linkUrl: '/categories/shoes',
      position: 3,
      startsAt,
      endsAt: null,
    });

    expect(banner).toMatchObject({
      assetId: imageId,
      mobileAssetId: mobile.id,
      altText: 'Holiday sale',
      title: 'Holiday Sale',
      subtitle: 'Up to 30% off',
      linkUrl: '/categories/shoes',
      position: 3,
      isActive: true,
      startsAt,
      endsAt: null,
    });
  });

  it('requires an image and alt text', async () => {
    const response = await asAdmin.post(url, { title: 'Sale' }).expect(400);

    expect(response.body.error.details.map((detail: { field: string }) => detail.field)).toEqual([
      'assetId',
      'altText',
    ]);
  });

  it('only accepts storefront paths and https links', async () => {
    await createBanner({ linkUrl: 'https://example.com/sale' });

    for (const linkUrl of [
      'javascript:alert(1)',
      'http://example.com',
      '//evil.example.com',
      '/\\evil.example.com',
      'products',
    ]) {
      await asAdmin.post(url, { assetId: imageId, altText: 'Sale', linkUrl }).expect(400);
    }
  });

  it('rejects an end date before the start date, including on update', async () => {
    const startsAt = new Date(Date.now() + hour).toISOString();
    const endsAt = new Date(Date.now() - hour).toISOString();

    await asAdmin.post(url, { assetId: imageId, altText: 'Sale', startsAt, endsAt }).expect(400);

    const banner = await createBanner({ startsAt });
    const response = await asAdmin.patch(`${url}/${banner.id}`, { endsAt }).expect(400);

    expect(response.body.error.message).toBe('endsAt must be after startsAt');
  });

  it('rejects images that do not exist', async () => {
    await asAdmin.post(url, { assetId: missingId, altText: 'Sale' }).expect(400);

    const banner = await createBanner();
    await asAdmin.patch(`${url}/${banner.id}`, { mobileAssetId: missingId }).expect(400);
  });

  it(`allows at most ${MAX_BANNERS} banners`, async () => {
    await Promise.all(Array.from({ length: MAX_BANNERS }, () => createBanner()));

    const response = await asAdmin.post(url, { assetId: imageId, altText: 'Sale' }).expect(409);

    expect(response.body.error.message).toBe(
      `A store can have at most ${MAX_BANNERS} banners. Delete one to add another.`,
    );

    const list = await asAdmin.get(`${url}/admin`).expect(200);
    expect(list.body.meta).toEqual({
      page: 1,
      limit: MAX_BANNERS,
      total: MAX_BANNERS,
      maxBanners: MAX_BANNERS,
    });
  });

  it('removes the mobile image, but not the default image', async () => {
    const mobile = await uploadImage();
    const banner = await createBanner({ mobileAssetId: mobile.id });

    const response = await asAdmin
      .patch(`${url}/${banner.id}`, { mobileAssetId: null })
      .expect(200);
    expect(response.body.data).toMatchObject({ mobileAssetId: null, mobileImageUrl: null });

    await asAdmin.patch(`${url}/${banner.id}`, { assetId: null }).expect(400);
  });

  it('blocks deleting an image a banner uses', async () => {
    const mobile = await uploadImage();
    await createBanner({ mobileAssetId: mobile.id });

    await asAdmin.delete(`/api/assets/${imageId}`).expect(409);
    await asAdmin.delete(`/api/assets/${mobile.id}`).expect(409);
  });

  it('deletes a banner and keeps its images', async () => {
    const banner = await createBanner();

    await asAdmin.delete(`${url}/${banner.id}`).expect(204);
    await asAdmin.delete(`${url}/${banner.id}`).expect(404);
    await asAdmin.patch(`${url}/${missingId}`, { position: 1 }).expect(404);

    expect(await db.select().from(banners)).toEqual([]);
    await asAdmin.delete(`/api/assets/${imageId}`).expect(204);
  });

  it('records each change in the audit log', async () => {
    const banner = await createBanner();
    await asAdmin.patch(`${url}/${banner.id}`, { title: 'Sale' }).expect(200);
    await asAdmin.delete(`${url}/${banner.id}`).expect(204);

    const entries = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'banner'), eq(auditLogs.entityId, banner.id)))
      .orderBy(auditLogs.createdAt);

    expect(entries.map((entry) => entry.action)).toEqual(['create', 'update', 'delete']);
    expect(entries[1]?.changes).toEqual({ title: [null, 'Sale'] });
  });
});
