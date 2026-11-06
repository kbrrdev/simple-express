import { readdir, rm } from 'node:fs/promises';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { db, pool } from '../src/db';
import { categories, productImages, users } from '../src/db/schema';

const password = 'correct-horse-battery';
const missingId = '00000000-0000-4000-8000-000000000000';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
  Buffer.alloc(32),
]);

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminToken: string;
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

const uploadFile = (file: Buffer, filename = 'photo.png', contentType = 'image/png') =>
  api().post('/api/assets').set(bearer(adminToken)).attach('file', file, { filename, contentType });

async function upload() {
  const response = await uploadFile(png).expect(201);
  return response.body.data as { id: string; url: string; mimeType: string; sizeBytes: number };
}

const asAdmin = {
  post: (url: string, body: object) => api().post(url).set(bearer(adminToken)).send(body),
  patch: (url: string, body: object) => api().patch(url).set(bearer(adminToken)).send(body),
  delete: (url: string) => api().delete(url).set(bearer(adminToken)),
};

async function createProduct() {
  const response = await asAdmin
    .post('/api/products', {
      categoryId,
      name: 'Classic T-Shirt',
      option1Name: 'Color',
      variants: [
        { option1Value: 'Red', priceCents: 1999, stock: 5 },
        { option1Value: 'Blue', priceCents: 1999, stock: 5 },
      ],
    })
    .expect(201);

  return response.body.data;
}

const addImage = (productId: string, assetId: string, altText?: string) =>
  asAdmin.post(`/api/products/${productId}/images`, { assetId, altText });

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  adminToken = await registerAndLogin('admin@example.com');
  await db.update(users).set({ role: 'admin' }).where(eq(users.email, 'admin@example.com'));
  customerToken = await registerAndLogin('customer@example.com');
});

beforeEach(async () => {
  await db.execute(sql`truncate table categories, products, blogs, assets cascade`);
  await rm(env.UPLOADS_DIR, { recursive: true, force: true });

  const [category] = await db.insert(categories).values({ name: 'Shirts' }).returning();
  if (!category) throw new Error('Failed to insert category');
  categoryId = category.id;
});

afterAll(async () => {
  await rm(env.UPLOADS_DIR, { recursive: true, force: true });
  await pool.end();
});

describe('uploading', () => {
  it('only allows admins', async () => {
    await api().post('/api/assets').attach('file', png, 'photo.png').expect(401);
    await api()
      .post('/api/assets')
      .set(bearer(customerToken))
      .attach('file', png, 'photo.png')
      .expect(403);
    await api().get('/api/assets').expect(401);
    await api().get('/api/assets').set(bearer(customerToken)).expect(403);
    await api().delete(`/api/assets/${missingId}`).set(bearer(customerToken)).expect(403);
  });

  it.each([
    ['a PNG', png, 'image/png', 'png'],
    ['a JPEG', jpeg, 'image/jpeg', 'jpg'],
    ['a WebP', webp, 'image/webp', 'webp'],
  ])('accepts %s', async (_name, file, mimeType, extension) => {
    const response = await uploadFile(file, 'photo', 'application/octet-stream').expect(201);

    expect(response.body.data).toMatchObject({ mimeType, sizeBytes: file.length });
    expect(response.body.data.url).toMatch(new RegExp(`\\.${extension}$`));
  });

  it.each([
    ['text renamed to .png', Buffer.from('not an image'), 'photo.png', 'image/png'],
    ['an SVG', Buffer.from('<svg onload="alert(1)"/>'), 'photo.svg', 'image/svg+xml'],
    ['HTML', Buffer.from('<script>alert(1)</script>'), 'photo.html', 'text/html'],
    ['an empty file', Buffer.alloc(0), 'photo.png', 'image/png'],
    ['a RIFF file that is not WebP', Buffer.from('RIFF0000WAVEfmt '), 'a.webp', 'image/webp'],
  ])('rejects %s and stores nothing', async (_name, file, filename, contentType) => {
    const response = await uploadFile(file, filename, contentType).expect(400);

    expect(response.body.error.message).toBe('File must be a JPEG, PNG, or WebP image');
    await expect(readdir(env.UPLOADS_DIR)).rejects.toThrow();
  });

  it('rejects a file over 5 MB', async () => {
    const tooLarge = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]);

    await uploadFile(tooLarge).expect(413);
  });

  it('accepts a file of exactly 5 MB', async () => {
    const atLimit = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 - png.length)]);

    await uploadFile(atLimit).expect(201);
  });

  it('rejects a missing file or the wrong field', async () => {
    await api().post('/api/assets').set(bearer(adminToken)).expect(400);
    await api()
      .post('/api/assets')
      .set(bearer(adminToken))
      .attach('image', png, 'photo.png')
      .expect(400);
  });

  it('rejects more than one file', async () => {
    await api()
      .post('/api/assets')
      .set(bearer(adminToken))
      .attach('file', png, 'one.png')
      .attach('file', png, 'two.png')
      .expect(400);
  });

  it('ignores the uploaded filename', async () => {
    const response = await uploadFile(png, '../../evil.png').expect(201);

    expect(response.body.data.url).toMatch(/\/uploads\/[0-9a-f]{8}-[0-9a-f-]{27}\.png$/);
  });
});

describe('serving', () => {
  it('serves uploads publicly and safely', async () => {
    const asset = await upload();
    const response = await api().get(new URL(asset.url).pathname).expect(200);

    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toContain('immutable');
    expect(Buffer.compare(response.body, png)).toBe(0);
  });

  it('cannot read files outside the uploads folder', async () => {
    await upload();

    await api().get('/uploads/..%2F..%2Fpackage.json').expect(404);
  });
});

describe('listing and deleting', () => {
  it('lists assets newest first without the storage path', async () => {
    const first = await upload();
    const second = await upload();

    const response = await api().get('/api/assets').set(bearer(adminToken)).expect(200);

    expect(response.body.meta).toEqual({ page: 1, limit: 20, total: 2 });
    expect(response.body.data.map((asset: { id: string }) => asset.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(response.body.data[0]).not.toHaveProperty('path');
  });

  it('deletes the row and the file', async () => {
    const asset = await upload();

    await asAdmin.delete(`/api/assets/${asset.id}`).expect(204);
    await asAdmin.delete(`/api/assets/${asset.id}`).expect(404);

    expect(await readdir(env.UPLOADS_DIR)).toEqual([]);
    await api().get(new URL(asset.url).pathname).expect(404);
  });

  it('cannot delete an asset used by a product', async () => {
    const asset = await upload();
    const product = await createProduct();
    await addImage(product.id, asset.id).expect(201);

    await asAdmin.delete(`/api/assets/${asset.id}`).expect(409);
    await api().get(new URL(asset.url).pathname).expect(200);
  });

  it('cannot delete an asset used as a blog cover', async () => {
    const asset = await upload();
    await asAdmin
      .post('/api/blogs', {
        title: 'Hello',
        content: 'First post',
        author: 'Jane',
        coverAssetId: asset.id,
      })
      .expect(201);

    await asAdmin.delete(`/api/assets/${asset.id}`).expect(409);
    await api().get(new URL(asset.url).pathname).expect(200);
  });
});

describe('product images', () => {
  it('adds images in order and shows them publicly', async () => {
    const product = await createProduct();
    const first = await upload();
    const second = await upload();

    const added = await addImage(product.id, first.id, 'Front view').expect(201);
    await addImage(product.id, second.id).expect(201);

    expect(added.body.data).toMatchObject({
      assetId: first.id,
      url: first.url,
      altText: 'Front view',
      position: 0,
    });

    const detail = await api().get(`/api/products/${product.id}`).expect(200);
    const list = await api().get('/api/products').expect(200);

    expect(detail.body.data.images.map((image: { url: string }) => image.url)).toEqual([
      first.url,
      second.url,
    ]);
    expect(list.body.data[0].images).toHaveLength(2);
  });

  it('starts new products with no images', async () => {
    const product = await createProduct();

    expect(product.images).toEqual([]);
  });

  it('changes the order and alt text', async () => {
    const product = await createProduct();
    const first = await upload();
    const second = await upload();
    const image = (await addImage(product.id, first.id).expect(201)).body.data;
    await addImage(product.id, second.id).expect(201);

    const response = await asAdmin
      .patch(`/api/products/${product.id}/images/${image.id}`, { position: 5, altText: 'Back' })
      .expect(200);
    const detail = await api().get(`/api/products/${product.id}`).expect(200);

    expect(response.body.data).toMatchObject({ position: 5, altText: 'Back' });
    expect(detail.body.data.images.map((row: { url: string }) => row.url)).toEqual([
      second.url,
      first.url,
    ]);
  });

  it('only lets admins change images', async () => {
    const product = await createProduct();
    const asset = await upload();
    const url = `/api/products/${product.id}/images`;
    const image = (await addImage(product.id, asset.id).expect(201)).body.data;

    await api().post(url).send({ assetId: asset.id }).expect(401);
    await api().post(url).set(bearer(customerToken)).send({ assetId: asset.id }).expect(403);
    await api()
      .patch(`${url}/${image.id}`)
      .set(bearer(customerToken))
      .send({ position: 1 })
      .expect(403);
    await api().delete(`${url}/${image.id}`).set(bearer(customerToken)).expect(403);
  });

  it('rejects a duplicate or unknown asset', async () => {
    const product = await createProduct();
    const asset = await upload();
    await addImage(product.id, asset.id).expect(201);

    await addImage(product.id, asset.id).expect(409);
    await addImage(product.id, missingId).expect(400);
    await addImage(missingId, asset.id).expect(404);
  });

  it('can share an asset between products', async () => {
    const asset = await upload();

    await addImage((await createProduct()).id, asset.id).expect(201);
    await addImage((await createProduct()).id, asset.id).expect(201);
  });

  it('allows 10 images per product', async () => {
    const product = await createProduct();

    for (let index = 0; index < 10; index++) {
      await addImage(product.id, (await upload()).id).expect(201);
    }

    const response = await addImage(product.id, (await upload()).id).expect(409);

    expect(response.body.error.message).toBe('A product can have up to 10 images');
  });

  it('cannot pass the limit with parallel requests', async () => {
    const product = await createProduct();
    const uploaded = await Promise.all(Array.from({ length: 15 }, () => upload()));

    for (const asset of uploaded.slice(0, 9)) {
      await addImage(product.id, asset.id).expect(201);
    }

    const responses = await Promise.all(
      uploaded.slice(9).map((asset) => addImage(product.id, asset.id)),
    );

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(await db.select().from(productImages)).toHaveLength(10);
  });

  it('removes an image but keeps the file', async () => {
    const product = await createProduct();
    const asset = await upload();
    const image = (await addImage(product.id, asset.id).expect(201)).body.data;

    await asAdmin.delete(`/api/products/${product.id}/images/${image.id}`).expect(204);
    await asAdmin.delete(`/api/products/${product.id}/images/${image.id}`).expect(404);

    await api().get(new URL(asset.url).pathname).expect(200);
  });

  it('cannot reach an image through another product', async () => {
    const first = await createProduct();
    const second = await createProduct();
    const image = (await addImage(first.id, (await upload()).id).expect(201)).body.data;
    const url = `/api/products/${second.id}/images/${image.id}`;

    await asAdmin.patch(url, { position: 1 }).expect(404);
    await asAdmin.delete(url).expect(404);
  });
});

describe('variant images', () => {
  it('links a variant to one of the product images', async () => {
    const product = await createProduct();
    const asset = await upload();
    await addImage(product.id, asset.id).expect(201);
    const url = `/api/products/${product.id}/variants/${product.variants[0].id}`;

    const response = await asAdmin.patch(url, { assetId: asset.id }).expect(200);

    expect(response.body.data.assetId).toBe(asset.id);

    const cleared = await asAdmin.patch(url, { assetId: null }).expect(200);

    expect(cleared.body.data.assetId).toBeNull();
  });

  it('lets several variants share one image', async () => {
    const product = await createProduct();
    const asset = await upload();
    await addImage(product.id, asset.id).expect(201);

    for (const variant of product.variants) {
      await asAdmin
        .patch(`/api/products/${product.id}/variants/${variant.id}`, { assetId: asset.id })
        .expect(200);
    }
  });

  it('rejects an asset that is not on the product', async () => {
    const product = await createProduct();
    const other = await createProduct();
    const asset = await upload();
    await addImage(other.id, asset.id).expect(201);
    const url = `/api/products/${product.id}/variants/${product.variants[0].id}`;

    const response = await asAdmin.patch(url, { assetId: asset.id }).expect(400);

    expect(response.body.error.message).toBe("Asset must be one of the product's images");
    await asAdmin.patch(url, { assetId: missingId }).expect(400);
  });

  it('cannot remove an image a variant uses', async () => {
    const product = await createProduct();
    const asset = await upload();
    const image = (await addImage(product.id, asset.id).expect(201)).body.data;
    const variantUrl = `/api/products/${product.id}/variants/${product.variants[0].id}`;
    await asAdmin.patch(variantUrl, { assetId: asset.id }).expect(200);

    await asAdmin.delete(`/api/products/${product.id}/images/${image.id}`).expect(409);

    await asAdmin.patch(variantUrl, { assetId: null }).expect(200);
    await asAdmin.delete(`/api/products/${product.id}/images/${image.id}`).expect(204);
  });

  it('cannot be set when creating a variant', async () => {
    const product = await createProduct();

    await asAdmin
      .post(`/api/products/${product.id}/variants`, {
        option1Value: 'Green',
        priceCents: 100,
        assetId: missingId,
      })
      .expect(400);
  });
});

describe('blog covers', () => {
  const blog = { title: 'Hello', content: 'First post', author: 'Jane' };

  it('sets, shows and clears a cover', async () => {
    const asset = await upload();
    const created = await asAdmin
      .post('/api/blogs', { ...blog, coverAssetId: asset.id })
      .expect(201);
    const path = `/api/blogs/${created.body.data.id}`;

    expect(created.body.data).toMatchObject({ coverAssetId: asset.id, coverImageUrl: asset.url });

    const list = await api().get('/api/blogs').expect(200);
    const detail = await api().get(path).expect(200);

    expect(list.body.data[0].coverImageUrl).toBe(asset.url);
    expect(detail.body.data.coverImageUrl).toBe(asset.url);

    const cleared = await asAdmin.patch(path, { coverAssetId: null }).expect(200);

    expect(cleared.body.data).toMatchObject({ coverAssetId: null, coverImageUrl: null });
  });

  it('adds a cover to an existing blog', async () => {
    const asset = await upload();
    const created = await asAdmin.post('/api/blogs', blog).expect(201);

    expect(created.body.data.coverImageUrl).toBeNull();

    const updated = await asAdmin
      .patch(`/api/blogs/${created.body.data.id}`, { coverAssetId: asset.id })
      .expect(200);

    expect(updated.body.data.coverImageUrl).toBe(asset.url);
  });

  it('rejects an unknown asset', async () => {
    const created = await asAdmin.post('/api/blogs', blog).expect(201);

    await asAdmin.post('/api/blogs', { ...blog, coverAssetId: missingId }).expect(400);
    await asAdmin
      .patch(`/api/blogs/${created.body.data.id}`, { coverAssetId: missingId })
      .expect(400);
  });
});

describe('cart images', () => {
  const preview = (variantId: string) =>
    api()
      .post('/api/cart/preview')
      .send({ items: [{ variantId, quantity: 1 }] })
      .expect(200);

  it('has no image when the product has none', async () => {
    const product = await createProduct();
    const response = await preview(product.variants[0].id);

    expect(response.body.data.items[0].imageUrl).toBeNull();
  });

  it('uses the first product image by default', async () => {
    const product = await createProduct();
    const first = await upload();
    await addImage(product.id, first.id).expect(201);
    await addImage(product.id, (await upload()).id).expect(201);

    const response = await preview(product.variants[0].id);

    expect(response.body.data.items[0].imageUrl).toBe(first.url);
  });

  it('prefers the image of the variant', async () => {
    const product = await createProduct();
    await addImage(product.id, (await upload()).id).expect(201);
    const second = await upload();
    await addImage(product.id, second.id).expect(201);
    await asAdmin
      .patch(`/api/products/${product.id}/variants/${product.variants[0].id}`, {
        assetId: second.id,
      })
      .expect(200);

    const response = await preview(product.variants[0].id);

    expect(response.body.data.items[0].imageUrl).toBe(second.url);
  });
});
