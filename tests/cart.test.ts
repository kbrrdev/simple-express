import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import { cartItems, categories, products, productVariants } from '../src/db/schema';

const password = 'correct-horse-battery';
const missingId = '00000000-0000-4000-8000-000000000000';

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let token: string;
let otherToken: string;
let shirtId: string;
let medium: string;
let large: string;
let mug: string;

async function registerAndLogin(email: string) {
  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

async function insertVariant(values: {
  productId: string;
  option1Value?: string;
  priceCents: number;
  stock: number;
}) {
  const [variant] = await db.insert(productVariants).values(values).returning();
  if (!variant) throw new Error('Failed to insert variant');
  return variant.id;
}

const add = (variantId: string, quantity?: number, user = token) =>
  api().post('/api/cart/items').set(bearer(user)).send({ variantId, quantity });

const getCart = (user = token) => api().get('/api/cart').set(bearer(user)).expect(200);

const merge = (items: object[]) =>
  api().post('/api/cart/merge').set(bearer(token)).send({ items }).expect(200);

const setStock = (variantId: string, stock: number) =>
  db.update(productVariants).set({ stock }).where(eq(productVariants.id, variantId));

const quantityOf = (body: { items: { variantId: string; quantity: number }[] }, id: string) =>
  body.items.find((item) => item.variantId === id)?.quantity;

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  token = await registerAndLogin('customer@example.com');
  otherToken = await registerAndLogin('other@example.com');
});

beforeEach(async () => {
  await db.execute(sql`truncate table categories, products cascade`);

  const [category] = await db.insert(categories).values({ name: 'Shirts' }).returning();
  if (!category) throw new Error('Failed to insert category');

  const [shirt, plainMug] = await db
    .insert(products)
    .values([
      { categoryId: category.id, name: 'Classic T-Shirt', option1Name: 'Size' },
      { categoryId: category.id, name: 'Mug' },
    ])
    .returning();
  if (!shirt || !plainMug) throw new Error('Failed to insert products');

  shirtId = shirt.id;
  medium = await insertVariant({
    productId: shirt.id,
    option1Value: 'M',
    priceCents: 1999,
    stock: 12,
  });
  large = await insertVariant({
    productId: shirt.id,
    option1Value: 'L',
    priceCents: 2199,
    stock: 3,
  });
  mug = await insertVariant({ productId: plainMug.id, priceCents: 999, stock: 200 });
});

afterAll(async () => {
  await pool.end();
});

describe('access', () => {
  it('requires a token, except for preview', async () => {
    await api().get('/api/cart').expect(401);
    await api().delete('/api/cart').expect(401);
    await api().post('/api/cart/items').send({ variantId: medium }).expect(401);
    await api().patch(`/api/cart/items/${medium}`).send({ quantity: 1 }).expect(401);
    await api().delete(`/api/cart/items/${medium}`).expect(401);
    await api().post('/api/cart/merge').send({ items: [] }).expect(401);
    await api().post('/api/cart/preview').send({ items: [] }).expect(200);
  });

  it('keeps carts separate between users', async () => {
    await add(medium, 2).expect(200);

    const other = await getCart(otherToken);

    expect(other.body.data.items).toEqual([]);
    await api().delete(`/api/cart/items/${medium}`).set(bearer(otherToken)).expect(404);
    await api()
      .patch(`/api/cart/items/${medium}`)
      .set(bearer(otherToken))
      .send({ quantity: 1 })
      .expect(404);
    await api().delete('/api/cart').set(bearer(otherToken)).expect(204);

    const mine = await getCart();

    expect(quantityOf(mine.body.data, medium)).toBe(2);
    await api().delete('/api/cart').set(bearer(token)).expect(204);
  });
});

describe('adding items', () => {
  beforeEach(async () => {
    await db.delete(cartItems);
  });

  it('returns the cart with product details and totals', async () => {
    const response = await add(medium, 2).expect(200);

    expect(response.body.data).toEqual({
      items: [
        {
          variantId: medium,
          productId: shirtId,
          productName: 'Classic T-Shirt',
          imageUrl: null,
          option1Name: 'Size',
          option1Value: 'M',
          option2Name: null,
          option2Value: null,
          unitPriceCents: 1999,
          quantity: 2,
          lineTotalCents: 3998,
          stock: 12,
          available: true,
        },
      ],
      subtotalCents: 3998,
    });
  });

  it('adds one by default', async () => {
    const response = await api()
      .post('/api/cart/items')
      .set(bearer(token))
      .send({ variantId: medium })
      .expect(200);

    expect(quantityOf(response.body.data, medium)).toBe(1);
  });

  it('totals several items', async () => {
    await add(medium, 2).expect(200);
    const response = await add(mug, 3).expect(200);

    expect(response.body.data.subtotalCents).toBe(3998 + 2997);
    expect(response.body.data.items).toHaveLength(2);
  });

  it('combines quantities when the same variant is added again', async () => {
    await add(medium, 2).expect(200);
    const response = await add(medium, 3).expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(quantityOf(response.body.data, medium)).toBe(5);
  });

  it('does not lose quantities from parallel requests', async () => {
    await Promise.all(Array.from({ length: 5 }, () => add(medium, 1).expect(200)));

    const cart = await getCart();

    expect(quantityOf(cart.body.data, medium)).toBe(5);
  });

  it('rejects more than the stock', async () => {
    const response = await add(large, 4);

    expect(response.status).toBe(409);
    expect(response.body.error.message).toBe('Quantity cannot exceed 3 for this item');
  });

  it('counts what is already in the cart against the stock', async () => {
    await add(large, 2).expect(200);
    await add(large, 2).expect(409);

    const cart = await getCart();

    expect(quantityOf(cart.body.data, large)).toBe(2);
  });

  it('never goes over the stock with parallel requests', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => add(large, 1)));
    const cart = await getCart();

    expect(quantityOf(cart.body.data, large)).toBe(3);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(3);
  });

  it('limits an item to 99, even with more stock', async () => {
    await add(mug, 99).expect(200);
    await add(mug, 1).expect(409);
    await add(mug, 100).expect(400);
  });

  it('rejects an out-of-stock variant', async () => {
    await setStock(medium, 0);

    await add(medium, 1).expect(409);
  });

  it('rejects a variant that is missing or deactivated', async () => {
    await add(missingId, 1).expect(404);

    await db.update(productVariants).set({ active: false }).where(eq(productVariants.id, medium));
    await add(medium, 1).expect(404);

    await db.update(products).set({ active: false }).where(eq(products.id, shirtId));
    await add(large, 1).expect(404);
  });

  it.each([
    ['zero', 0],
    ['a negative number', -1],
    ['a fraction', 1.5],
  ])('rejects a quantity of %s', async (_name, quantity) => {
    await add(medium, quantity).expect(400);
  });

  it('rejects an invalid variant id', async () => {
    await add('nope', 1).expect(400);
  });
});

describe('changing items', () => {
  beforeEach(async () => {
    await db.delete(cartItems);
    await add(medium, 2).expect(200);
  });

  const patch = (variantId: string, quantity: number) =>
    api().patch(`/api/cart/items/${variantId}`).set(bearer(token)).send({ quantity });

  it('sets the quantity', async () => {
    const response = await patch(medium, 5).expect(200);

    expect(quantityOf(response.body.data, medium)).toBe(5);
  });

  it('rejects more than the stock', async () => {
    await patch(medium, 13).expect(409);
  });

  it('rejects zero', async () => {
    await patch(medium, 0).expect(400);
  });

  it('returns 404 for an item not in the cart', async () => {
    await patch(mug, 1).expect(404);
  });

  it('cannot change an item that became unavailable', async () => {
    await db.update(productVariants).set({ active: false }).where(eq(productVariants.id, medium));

    await patch(medium, 1).expect(404);
  });

  it('removes an item', async () => {
    await api().delete(`/api/cart/items/${medium}`).set(bearer(token)).expect(204);
    await api().delete(`/api/cart/items/${medium}`).set(bearer(token)).expect(404);

    const cart = await getCart();

    expect(cart.body.data).toEqual({ items: [], subtotalCents: 0 });
  });

  it('can remove an item that became unavailable', async () => {
    await db.update(products).set({ active: false }).where(eq(products.id, shirtId));

    await api().delete(`/api/cart/items/${medium}`).set(bearer(token)).expect(204);
  });

  it('empties the cart', async () => {
    await add(mug, 1).expect(200);
    await api().delete('/api/cart').set(bearer(token)).expect(204);
    await api().delete('/api/cart').set(bearer(token)).expect(204);

    const cart = await getCart();

    expect(cart.body.data.items).toEqual([]);
  });
});

describe('changes after adding', () => {
  beforeEach(async () => {
    await db.delete(cartItems);
    await add(medium, 2).expect(200);
    await add(mug, 1).expect(200);
  });

  it('uses the current price', async () => {
    await db
      .update(productVariants)
      .set({ priceCents: 1000 })
      .where(eq(productVariants.id, medium));

    const cart = await getCart();

    expect(cart.body.data.subtotalCents).toBe(2000 + 999);
  });

  it('marks a deactivated variant and leaves it out of the subtotal', async () => {
    await db.update(productVariants).set({ active: false }).where(eq(productVariants.id, medium));

    const cart = await getCart();
    const [item] = cart.body.data.items;

    expect(item).toMatchObject({ variantId: medium, available: false, quantity: 2 });
    expect(cart.body.data.subtotalCents).toBe(999);
  });

  it('marks items of a deactivated product', async () => {
    await db.update(products).set({ active: false }).where(eq(products.id, shirtId));

    const cart = await getCart();

    expect(cart.body.data.items[0].available).toBe(false);
    expect(cart.body.data.subtotalCents).toBe(999);
  });

  it('keeps an item when stock drops below its quantity', async () => {
    await setStock(medium, 1);

    const cart = await getCart();

    expect(cart.body.data.items[0]).toMatchObject({ quantity: 2, stock: 1, available: true });
  });
});

describe('guest cart preview', () => {
  const preview = (items: object[]) => api().post('/api/cart/preview').send({ items });

  beforeEach(async () => {
    await db.delete(cartItems);
  });

  it('prices items without saving them', async () => {
    const response = await preview([
      { variantId: mug, quantity: 2 },
      { variantId: medium, quantity: 1 },
    ]).expect(200);

    expect(response.body.data.subtotalCents).toBe(1998 + 1999);
    expect(response.body.data.items.map((item: { variantId: string }) => item.variantId)).toEqual([
      mug,
      medium,
    ]);
    expect(await db.select().from(cartItems)).toEqual([]);
  });

  it('marks unavailable variants and leaves out missing ones', async () => {
    await db.update(productVariants).set({ active: false }).where(eq(productVariants.id, medium));

    const response = await preview([
      { variantId: medium, quantity: 1 },
      { variantId: missingId, quantity: 1 },
    ]).expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].available).toBe(false);
    expect(response.body.data.subtotalCents).toBe(0);
  });

  it('rejects duplicates, bad quantities and too many items', async () => {
    const item = { variantId: medium, quantity: 1 };
    const tooMany = Array.from({ length: 101 }, (_value, index) => ({
      variantId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      quantity: 1,
    }));

    await preview([item, item]).expect(400);
    await preview([{ ...item, quantity: 0 }]).expect(400);
    await preview(tooMany).expect(400);
    await api().post('/api/cart/preview').send({}).expect(400);
  });
});

describe('merging a guest cart', () => {
  beforeEach(async () => {
    await db.delete(cartItems);
  });

  it('adds guest items to the cart', async () => {
    const response = await merge([{ variantId: medium, quantity: 2 }]);

    expect(quantityOf(response.body.data, medium)).toBe(2);
    expect(response.body.data.adjustments).toEqual([]);
  });

  it('keeps items already in the cart', async () => {
    await add(mug, 1).expect(200);

    const response = await merge([{ variantId: medium, quantity: 2 }]);

    expect(response.body.data.items).toHaveLength(2);
  });

  it('keeps the higher quantity when an item is in both carts', async () => {
    await add(medium, 5).expect(200);
    await add(mug, 1).expect(200);

    const response = await merge([
      { variantId: medium, quantity: 2 },
      { variantId: mug, quantity: 4 },
    ]);

    expect(quantityOf(response.body.data, medium)).toBe(5);
    expect(quantityOf(response.body.data, mug)).toBe(4);
  });

  it('changes nothing when repeated', async () => {
    const items = [{ variantId: medium, quantity: 2 }];

    await merge(items);
    const response = await merge(items);

    expect(quantityOf(response.body.data, medium)).toBe(2);
  });

  it('reduces a quantity to the stock', async () => {
    const response = await merge([{ variantId: large, quantity: 5 }]);

    expect(quantityOf(response.body.data, large)).toBe(3);
    expect(response.body.data.adjustments).toEqual([
      { variantId: large, requestedQuantity: 5, addedQuantity: 3 },
    ]);
  });

  it('skips unavailable, missing and out-of-stock variants, and merges the rest', async () => {
    await db.update(productVariants).set({ active: false }).where(eq(productVariants.id, medium));
    await setStock(large, 0);

    const response = await merge([
      { variantId: medium, quantity: 1 },
      { variantId: large, quantity: 2 },
      { variantId: missingId, quantity: 3 },
      { variantId: mug, quantity: 1 },
    ]);

    expect(response.body.data.items.map((item: { variantId: string }) => item.variantId)).toEqual([
      mug,
    ]);
    expect(response.body.data.adjustments).toEqual([
      { variantId: medium, requestedQuantity: 1, addedQuantity: 0 },
      { variantId: large, requestedQuantity: 2, addedQuantity: 0 },
      { variantId: missingId, requestedQuantity: 3, addedQuantity: 0 },
    ]);
  });

  it('accepts an empty guest cart', async () => {
    await add(mug, 1).expect(200);

    const response = await merge([]);

    expect(response.body.data.items).toHaveLength(1);
  });

  it('rejects duplicates', async () => {
    const item = { variantId: medium, quantity: 1 };

    await api()
      .post('/api/cart/merge')
      .set(bearer(token))
      .send({ items: [item, item] })
      .expect(400);
  });
});
