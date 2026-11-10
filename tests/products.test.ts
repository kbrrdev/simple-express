import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import { products, productVariants, users } from '../src/db/schema';

const admin = { email: 'admin@example.com', password: 'correct-horse-battery' };
const customer = { email: 'customer@example.com', password: 'correct-horse-battery' };
const missingId = '00000000-0000-4000-8000-000000000000';

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminToken: string;
let customerToken: string;
let categoryId: string;

async function registerAndLogin(credentials: typeof admin) {
  await api().post('/api/auth/register').send(credentials).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ ...credentials, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

const asAdmin = {
  post: (url: string, body: object) => api().post(url).set(bearer(adminToken)).send(body),
  patch: (url: string, body: object) => api().patch(url).set(bearer(adminToken)).send(body),
  delete: (url: string) => api().delete(url).set(bearer(adminToken)),
  get: (url: string) => api().get(url).set(bearer(adminToken)),
};

const shirt = () => ({
  categoryId,
  name: 'Classic T-Shirt',
  option1Name: 'Size',
  option2Name: 'Color',
  variants: [
    { option1Value: 'M', option2Value: 'Red', priceCents: 1999, stock: 12 },
    { option1Value: 'L', option2Value: 'Red', priceCents: 2199, stock: 5 },
  ],
});

const mug = () => ({ categoryId, name: 'Mug', variants: [{ priceCents: 999, stock: 3 }] });

async function createProduct(body: object) {
  const response = await asAdmin.post('/api/products', body).expect(201);
  return response.body.data;
}

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  await registerAndLogin(admin);
  await db.update(users).set({ role: 'admin' }).where(eq(users.email, admin.email));
  adminToken = (
    await api()
      .post('/api/auth/login')
      .send({ ...admin, client: 'native' })
      .expect(200)
  ).body.data.accessToken;

  customerToken = await registerAndLogin(customer);
});

beforeEach(async () => {
  await db.execute(sql`truncate table categories, products cascade`);
  const response = await asAdmin.post('/api/categories', { name: 'T-Shirts' }).expect(201);
  categoryId = response.body.data.id;
});

afterAll(async () => {
  await pool.end();
});

describe('categories', () => {
  it('is public to read', async () => {
    const list = await api().get('/api/categories').expect(200);

    expect(list.body.meta.total).toBe(1);
    await api().get(`/api/categories/${categoryId}`).expect(200);
    await api().get(`/api/categories/${missingId}`).expect(404);
  });

  it('only lets admins write', async () => {
    const url = `/api/categories/${categoryId}`;

    await api().post('/api/categories').send({ name: 'Bags' }).expect(401);
    await api()
      .post('/api/categories')
      .set(bearer(customerToken))
      .send({ name: 'Bags' })
      .expect(403);
    await api().patch(url).set(bearer(customerToken)).send({ name: 'Bags' }).expect(403);
    await api().delete(url).set(bearer(customerToken)).expect(403);
  });

  it('rejects a duplicate name on create and rename', async () => {
    const bags = await asAdmin.post('/api/categories', { name: 'Bags' }).expect(201);

    await asAdmin.post('/api/categories', { name: 'Bags' }).expect(409);
    await asAdmin.patch(`/api/categories/${bags.body.data.id}`, { name: 'T-Shirts' }).expect(409);
  });

  it('can be deleted only when no product uses it', async () => {
    const product = await createProduct(mug());

    await asAdmin.delete(`/api/categories/${categoryId}`).expect(409);
    await asAdmin.delete(`/api/products/${product.id}`).expect(204);
    await asAdmin.delete(`/api/categories/${categoryId}`).expect(409);

    await db.delete(products);
    await asAdmin.delete(`/api/categories/${categoryId}`).expect(204);
    await asAdmin.delete(`/api/categories/${categoryId}`).expect(404);
  });
});

describe('creating products', () => {
  it('creates a product with two options', async () => {
    const response = await asAdmin.post('/api/products', shirt()).expect(201);
    const { id, option1Name, option2Name, variants } = response.body.data;

    expect(response.headers.location).toBe(`/api/products/${id}`);
    expect([option1Name, option2Name]).toEqual(['Size', 'Color']);
    expect(variants).toHaveLength(2);
    expect(variants[0]).toMatchObject({ productId: id, active: true });
  });

  it('creates a product with one option', async () => {
    const product = await createProduct({
      categoryId,
      name: 'Sticker',
      option1Name: 'Size',
      variants: [{ option1Value: 'Large', priceCents: 100 }],
    });

    expect(product.option2Name).toBeNull();
    expect(product.variants[0]).toMatchObject({
      option1Value: 'Large',
      option2Value: null,
      stock: 0,
    });
  });

  it('creates a product with no options', async () => {
    const product = await createProduct(mug());

    expect(product.option1Name).toBeNull();
    expect(product.variants[0]).toMatchObject({ option1Value: null, option2Value: null });
  });

  it('requires at least one variant', async () => {
    await asAdmin.post('/api/products', { ...mug(), variants: [] }).expect(400);
  });

  it('rejects a second option without a first', async () => {
    const body = { ...shirt(), option1Name: undefined };

    await asAdmin.post('/api/products', body).expect(400);
  });

  it('does not accept a third option', async () => {
    await asAdmin.post('/api/products', { ...shirt(), option3Name: 'Fit' }).expect(400);
  });

  it.each([
    ['missing a value', [{ option1Value: 'M', priceCents: 100 }]],
    ['a value for an option that does not exist', [{ option2Value: 'Red', priceCents: 100 }]],
    ['no values', [{ priceCents: 100 }]],
  ])('rejects a variant with %s', async (_name, variants) => {
    await asAdmin.post('/api/products', { ...shirt(), variants }).expect(400);
  });

  it('rejects option values on a product with no options', async () => {
    const variants = [{ option1Value: 'M', priceCents: 100 }];

    await asAdmin.post('/api/products', { ...mug(), variants }).expect(400);
  });

  it.each([
    ['a negative price', { priceCents: -1 }],
    ['a fractional price', { priceCents: 19.99 }],
    ['a price too large to store', { priceCents: 2147483648 }],
    ['negative stock', { priceCents: 100, stock: -1 }],
  ])('rejects %s', async (_name, variant) => {
    await asAdmin.post('/api/products', { ...mug(), variants: [variant] }).expect(400);
  });

  it('rejects duplicate variants and saves nothing', async () => {
    const variant = shirt().variants[0];
    const response = await asAdmin.post('/api/products', {
      ...shirt(),
      variants: [variant, variant],
    });

    expect(response.status).toBe(409);
    expect(await db.select().from(products)).toEqual([]);
  });

  it('rejects duplicate variants on a product with no options', async () => {
    const variants = [{ priceCents: 100 }, { priceCents: 200 }];

    await asAdmin.post('/api/products', { ...mug(), variants }).expect(409);
  });

  it('rejects an unknown category', async () => {
    await asAdmin.post('/api/products', { ...mug(), categoryId: missingId }).expect(400);
    expect(await db.select().from(products)).toEqual([]);
  });
});

describe('browsing products', () => {
  it('lists products with their variants, without a token', async () => {
    await createProduct(shirt());

    const response = await api().get('/api/products').expect(200);

    expect(response.body.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(response.body.data[0].variants).toHaveLength(2);
  });

  it('paginates', async () => {
    await createProduct(mug());
    await createProduct(shirt());

    const response = await api().get('/api/products?limit=1&page=2').expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta).toEqual({ page: 2, limit: 1, total: 2 });
  });

  it('sorts newest first by default, or by name', async () => {
    await createProduct(mug());
    await createProduct(shirt());

    const newest = await api().get('/api/products?sort=newest').expect(200);
    const byDefault = await api().get('/api/products').expect(200);
    const byName = await api().get('/api/products?sort=name').expect(200);

    expect(newest.body.data[0].name).toBe('Classic T-Shirt');
    expect(byDefault.body.data[0].name).toBe('Classic T-Shirt');
    expect(byName.body.data[0].name).toBe('Classic T-Shirt');

    await createProduct({ ...mug(), name: 'Zebra Mug' });
    await createProduct({ ...mug(), name: 'Apron' });

    const reordered = await api().get('/api/products?sort=name').expect(200);
    const names = reordered.body.data.map((product: { name: string }) => product.name);

    expect(names).toEqual(['Apron', 'Classic T-Shirt', 'Mug', 'Zebra Mug']);
    await api().get('/api/products?sort=price').expect(400);
  });

  it('searches by part of the name, ignoring case', async () => {
    await createProduct(mug());
    await createProduct(shirt());

    const response = await api().get('/api/products?search=T-SHIRT').expect(200);

    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0].name).toBe('Classic T-Shirt');
  });

  it('treats search wildcards as plain text', async () => {
    await createProduct(mug());
    await createProduct({ ...mug(), name: '100% Cotton Tote' });

    const percent = await api().get('/api/products').query({ search: '%' }).expect(200);
    const underscore = await api().get('/api/products').query({ search: 'M_g' }).expect(200);

    expect(percent.body.data.map((product: { name: string }) => product.name)).toEqual([
      '100% Cotton Tote',
    ]);
    expect(underscore.body.meta.total).toBe(0);
  });

  it('filters by category', async () => {
    const bags = await asAdmin.post('/api/categories', { name: 'Bags' }).expect(201);
    await createProduct(mug());
    await createProduct({ ...mug(), name: 'Tote', categoryId: bags.body.data.id });

    const response = await api()
      .get('/api/products')
      .query({ categoryId: bags.body.data.id })
      .expect(200);

    expect(response.body.data.map((product: { name: string }) => product.name)).toEqual(['Tote']);
  });

  it('hides deactivated products', async () => {
    const product = await createProduct(mug());

    await asAdmin.delete(`/api/products/${product.id}`).expect(204);

    const list = await api().get('/api/products').expect(200);

    expect(list.body.meta.total).toBe(0);
    await api().get(`/api/products/${product.id}`).expect(404);
  });

  it('hides deactivated variants', async () => {
    const product = await createProduct(shirt());
    const [first, second] = product.variants;

    await asAdmin.delete(`/api/products/${product.id}/variants/${first.id}`).expect(204);

    const response = await api().get(`/api/products/${product.id}`).expect(200);

    expect(response.body.data.variants.map((variant: { id: string }) => variant.id)).toEqual([
      second.id,
    ]);
  });

  it('hides a product when none of its variants are active', async () => {
    const product = await createProduct(mug());

    await asAdmin.delete(`/api/products/${product.id}/variants/${product.variants[0].id}`);

    const list = await api().get('/api/products').expect(200);

    expect(list.body.meta.total).toBe(0);
    await api().get(`/api/products/${product.id}`).expect(404);
  });

  it('returns 400 for an invalid id', async () => {
    await api().get('/api/products/nope').expect(400);
  });
});

describe('the admin product list', () => {
  it('only allows admins', async () => {
    await api().get('/api/products/admin').expect(401);
    await api().get('/api/products/admin').set(bearer(customerToken)).expect(403);
  });

  it('includes inactive products and variants', async () => {
    const product = await createProduct(shirt());

    await asAdmin.delete(`/api/products/${product.id}/variants/${product.variants[0].id}`);
    await asAdmin.delete(`/api/products/${product.id}`).expect(204);

    const response = await asAdmin.get('/api/products/admin').expect(200);

    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0].active).toBe(false);
    expect(response.body.data[0].variants).toHaveLength(2);
  });
});

describe('getting a product as an admin', () => {
  it('only allows admins', async () => {
    const product = await createProduct(shirt());
    const url = `/api/products/admin/${product.id}`;

    await api().get(url).expect(401);
    await api().get(url).set(bearer(customerToken)).expect(403);
  });

  it('returns inactive products and variants', async () => {
    const product = await createProduct(shirt());

    const removedId = product.variants[0].id;

    await asAdmin.delete(`/api/products/${product.id}/variants/${removedId}`);
    await asAdmin.delete(`/api/products/${product.id}`).expect(204);

    const response = await asAdmin.get(`/api/products/admin/${product.id}`).expect(200);
    const variants: { id: string; active: boolean }[] = response.body.data.variants;

    expect(response.body.data.active).toBe(false);
    expect(variants).toHaveLength(2);
    expect(variants.find((variant) => variant.id === removedId)?.active).toBe(false);
  });

  it('returns 404 for an unknown product and 400 for an invalid id', async () => {
    await asAdmin.get('/api/products/admin/00000000-0000-4000-8000-000000000000').expect(404);
    await asAdmin.get('/api/products/admin/nope').expect(400);
  });
});

describe('updating products', () => {
  it('only lets admins write', async () => {
    const product = await createProduct(shirt());
    const url = `/api/products/${product.id}`;
    const variantUrl = `${url}/variants/${product.variants[0].id}`;
    const variant = { option1Value: 'S', option2Value: 'Red', priceCents: 100 };

    await api().post('/api/products').send(shirt()).expect(401);
    await api().post('/api/products').set(bearer(customerToken)).send(shirt()).expect(403);
    await api().patch(url).send({ name: 'x' }).expect(401);
    await api().patch(url).set(bearer(customerToken)).send({ name: 'x' }).expect(403);
    await api().delete(url).expect(401);
    await api().delete(url).set(bearer(customerToken)).expect(403);
    await api().post(`${url}/variants`).set(bearer(customerToken)).send(variant).expect(403);
    await api().patch(variantUrl).set(bearer(customerToken)).send({ stock: 1 }).expect(403);
    await api().delete(variantUrl).set(bearer(customerToken)).expect(403);
  });

  it('updates details and renames options', async () => {
    const product = await createProduct(shirt());

    const response = await asAdmin
      .patch(`/api/products/${product.id}`, { name: 'Tee', option1Name: 'Fit' })
      .expect(200);

    expect(response.body.data).toMatchObject({ name: 'Tee', option1Name: 'Fit' });
    expect(response.body.data.variants).toHaveLength(2);
  });

  it('cannot add options after creation', async () => {
    const noOptions = await createProduct(mug());
    const oneOption = await createProduct({
      categoryId,
      name: 'Sticker',
      option1Name: 'Size',
      variants: [{ option1Value: 'Large', priceCents: 100 }],
    });

    await asAdmin.patch(`/api/products/${noOptions.id}`, { option1Name: 'Size' }).expect(409);
    await asAdmin.patch(`/api/products/${oneOption.id}`, { option2Name: 'Color' }).expect(409);
  });

  it('cannot remove options after creation', async () => {
    const product = await createProduct(shirt());

    await asAdmin.patch(`/api/products/${product.id}`, { option2Name: null }).expect(400);
  });

  it('rejects an unknown category', async () => {
    const product = await createProduct(mug());

    await asAdmin.patch(`/api/products/${product.id}`, { categoryId: missingId }).expect(400);
  });

  it('restores a deactivated product', async () => {
    const product = await createProduct(mug());

    await asAdmin.delete(`/api/products/${product.id}`).expect(204);
    await asAdmin.patch(`/api/products/${product.id}`, { active: true }).expect(200);
    await api().get(`/api/products/${product.id}`).expect(200);
  });

  it('returns 404 for a missing product', async () => {
    await asAdmin.patch(`/api/products/${missingId}`, { name: 'x' }).expect(404);
    await asAdmin.delete(`/api/products/${missingId}`).expect(404);
  });
});

describe('variants', () => {
  const small = { option1Value: 'S', option2Value: 'Red', priceCents: 1799, stock: 2 };

  it('adds a variant', async () => {
    const product = await createProduct(shirt());

    const response = await asAdmin.post(`/api/products/${product.id}/variants`, small).expect(201);

    expect(response.body.data).toMatchObject({ ...small, productId: product.id });
  });

  it('rejects a duplicate or mismatched variant', async () => {
    const product = await createProduct(shirt());
    const url = `/api/products/${product.id}/variants`;

    await asAdmin.post(url, small).expect(201);
    await asAdmin.post(url, small).expect(409);
    await asAdmin.post(url, { option1Value: 'S', priceCents: 100 }).expect(400);
  });

  it('updates price and stock', async () => {
    const product = await createProduct(shirt());
    const url = `/api/products/${product.id}/variants/${product.variants[0].id}`;

    const response = await asAdmin.patch(url, { priceCents: 1500, stock: 0 }).expect(200);

    expect(response.body.data).toMatchObject({ priceCents: 1500, stock: 0 });
  });

  it('rejects changing values to an existing combination', async () => {
    const product = await createProduct(shirt());
    const [medium] = product.variants;
    const url = `/api/products/${product.id}/variants/${medium.id}`;

    await asAdmin.patch(url, { option1Value: 'L' }).expect(409);
  });

  it('cannot set a value for an option the product does not have', async () => {
    const product = await createProduct(mug());
    const url = `/api/products/${product.id}/variants/${product.variants[0].id}`;

    await asAdmin.patch(url, { option1Value: 'M' }).expect(400);
  });

  it('restores a deactivated variant', async () => {
    const product = await createProduct(mug());
    const url = `/api/products/${product.id}/variants/${product.variants[0].id}`;

    await asAdmin.delete(url).expect(204);
    await asAdmin.patch(url, { active: true }).expect(200);
    await api().get(`/api/products/${product.id}`).expect(200);
  });

  it('cannot reach a variant through another product', async () => {
    const first = await createProduct(shirt());
    const second = await createProduct(mug());
    const url = `/api/products/${second.id}/variants/${first.variants[0].id}`;

    await asAdmin.patch(url, { stock: 1 }).expect(404);
    await asAdmin.delete(url).expect(404);

    const [variant] = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, first.variants[0].id));

    expect(variant).toMatchObject({ stock: 12, active: true });
  });

  it('returns 404 for a missing product or variant', async () => {
    const product = await createProduct(shirt());

    await asAdmin.post(`/api/products/${missingId}/variants`, small).expect(404);
    await asAdmin
      .patch(`/api/products/${product.id}/variants/${missingId}`, { stock: 1 })
      .expect(404);
    await asAdmin.delete(`/api/products/${product.id}/variants/${missingId}`).expect(404);
  });
});

describe('the OpenAPI document', () => {
  it('includes the new modules', async () => {
    const response = await api().get('/api-docs.json').expect(200);

    expect(response.body.paths).toHaveProperty(['/api/products/{id}/variants/{variantId}']);
    expect(response.body.paths).toHaveProperty(['/api/categories/{id}']);
  });
});
