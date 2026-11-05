import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import { addresses, users } from '../src/db/schema';

const password = 'correct-horse-battery';
const missingId = '00000000-0000-4000-8000-000000000000';
const url = '/api/addresses';

const address = {
  recipientName: 'Juan Dela Cruz',
  phone: '09171234567',
  line1: '123 Rizal Street',
  barangay: 'San Antonio',
  city: 'Pasig',
  province: 'Metro Manila',
  postalCode: '1605',
};

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let token: string;
let otherToken: string;

async function registerAndLogin(email: string) {
  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

const post = (body: object, user = token) => api().post(url).set(bearer(user)).send(body);

async function create(line1 = address.line1) {
  const response = await post({ ...address, line1 }).expect(201);
  return response.body.data;
}

async function list() {
  const response = await api().get(url).set(bearer(token)).expect(200);
  return response.body.data as { id: string; isDefault: boolean; line1: string }[];
}

const makeDefault = (id: string, user = token) =>
  api().post(`${url}/${id}/default`).set(bearer(user));

const remove = (id: string, user = token) => api().delete(`${url}/${id}`).set(bearer(user));

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  token = await registerAndLogin('customer@example.com');
  otherToken = await registerAndLogin('other@example.com');
});

beforeEach(async () => {
  await db.delete(addresses);
});

afterAll(async () => {
  await pool.end();
});

describe('access', () => {
  it('requires a token', async () => {
    await api().get(url).expect(401);
    await api().post(url).send(address).expect(401);
    await api().get(`${url}/${missingId}`).expect(401);
    await api().patch(`${url}/${missingId}`).send({ city: 'x' }).expect(401);
    await api().delete(`${url}/${missingId}`).expect(401);
    await api().post(`${url}/${missingId}/default`).expect(401);
  });

  it("hides another user's address behind a 404", async () => {
    const mine = await create();
    const path = `${url}/${mine.id}`;

    await api().get(path).set(bearer(otherToken)).expect(404);
    await api().patch(path).set(bearer(otherToken)).send({ city: 'Taguig' }).expect(404);
    await remove(mine.id, otherToken).expect(404);
    await makeDefault(mine.id, otherToken).expect(404);

    const response = await api().get(path).set(bearer(token)).expect(200);

    expect(response.body.data).toMatchObject({ city: 'Pasig', isDefault: true });
  });

  it("does not list another user's addresses", async () => {
    await create();

    const response = await api().get(url).set(bearer(otherToken)).expect(200);

    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(0);
  });

  it('gives each user their own default', async () => {
    await post(address).expect(201);
    const other = await post(address, otherToken).expect(201);

    expect(other.body.data.isDefault).toBe(true);
    await db.delete(addresses);
  });
});

describe('creating an address', () => {
  it('saves the address for the current user', async () => {
    const [user] = await db.select().from(users).where(eq(users.email, 'customer@example.com'));
    const response = await post({ ...address, line2: 'Sunrise Village' }).expect(201);

    expect(response.headers.location).toBe(`${url}/${response.body.data.id}`);
    expect(response.body.data).toMatchObject({
      ...address,
      phone: '+639171234567',
      line2: 'Sunrise Village',
      userId: user?.id,
    });
  });

  it('makes line2 optional', async () => {
    const created = await create();

    expect(created.line2).toBe('');
  });

  it.each([
    ['09171234567'],
    ['+639171234567'],
    ['0917 123 4567'],
    ['0917-123-4567'],
    ['+63 917 123 4567'],
  ])('stores the phone number %s in one format', async (phone) => {
    const response = await post({ ...address, phone }).expect(201);

    expect(response.body.data.phone).toBe('+639171234567');
  });

  it.each([
    ['a landline', '0281234567'],
    ['a landline with +63', '+63281234567'],
    ['a short number', '0917123456'],
    ['a long number', '091712345678'],
    ['a foreign number', '+14155552671'],
    ['letters', '0917abc4567'],
    ['63 without the plus sign', '639171234567'],
  ])('rejects %s', async (_name, phone) => {
    const response = await post({ ...address, phone }).expect(400);

    expect(response.body.error.details[0].message).toBe(
      'Phone must be a Philippine mobile number, such as 09171234567',
    );
  });

  it.each(['160', '16055', 'ABCD'])('rejects the postal code %s', async (postalCode) => {
    const response = await post({ ...address, postalCode }).expect(400);

    expect(response.body.error.details[0].message).toBe('Postal code must be 4 digits');
  });

  it.each(['recipientName', 'phone', 'line1', 'barangay', 'city', 'province', 'postalCode'])(
    'requires %s',
    async (field) => {
      await post({ ...address, [field]: undefined }).expect(400);
    },
  );

  it.each([
    ['country', 'US'],
    ['userId', missingId],
    ['isDefault', true],
  ])('does not accept %s', async (field, value) => {
    await post({ ...address, [field]: value }).expect(400);
  });
});

describe('the default address', () => {
  it('is the first address added', async () => {
    const first = await create('First');
    const second = await create('Second');

    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);
  });

  it('comes first in the list', async () => {
    await create('First');
    const second = await create('Second');
    await create('Third');

    await makeDefault(second.id).expect(200);

    expect((await list()).map(({ line1 }) => line1)).toEqual(['Second', 'Third', 'First']);
  });

  it('moves to the chosen address', async () => {
    const first = await create('First');
    const second = await create('Second');

    const response = await makeDefault(second.id).expect(200);
    const rows = await list();

    expect(response.body.data).toMatchObject({ id: second.id, isDefault: true });
    expect(rows.filter(({ isDefault }) => isDefault).map(({ id }) => id)).toEqual([second.id]);
    expect(rows.find(({ id }) => id === first.id)?.isDefault).toBe(false);
  });

  it('can be chosen again without error', async () => {
    const first = await create();

    await makeDefault(first.id).expect(200);
    await makeDefault(first.id).expect(200);

    expect((await list())[0]?.isDefault).toBe(true);
  });

  it('moves to the newest remaining address when deleted', async () => {
    const first = await create('First');
    await create('Second');
    const third = await create('Third');

    await remove(first.id).expect(204);

    const rows = await list();

    expect(rows.filter(({ isDefault }) => isDefault).map(({ id }) => id)).toEqual([third.id]);
  });

  it('stays put when another address is deleted', async () => {
    const first = await create('First');
    const second = await create('Second');

    await remove(second.id).expect(204);

    expect((await list()).map(({ id, isDefault }) => [id, isDefault])).toEqual([[first.id, true]]);
  });

  it('is given to the next address after the last one is deleted', async () => {
    const only = await create('Only');

    await remove(only.id).expect(204);

    expect((await create('Next')).isDefault).toBe(true);
  });

  it('is enforced by the database', async () => {
    const first = await create('First');
    const second = await create('Second');

    await expect(
      db.update(addresses).set({ isDefault: true }).where(eq(addresses.id, second.id)),
    ).rejects.toThrow();

    expect(first.isDefault).toBe(true);
  });

  it('stays single when addresses are created in parallel', async () => {
    await Promise.all(Array.from({ length: 5 }, () => post(address).expect(201)));

    const rows = await list();

    expect(rows).toHaveLength(5);
    expect(rows.filter(({ isDefault }) => isDefault)).toHaveLength(1);
  });

  it('stays single when changed in parallel', async () => {
    await create('First');
    const second = await create('Second');
    const third = await create('Third');

    await Promise.all([
      makeDefault(second.id).expect(200),
      makeDefault(third.id).expect(200),
      makeDefault(second.id).expect(200),
    ]);

    expect((await list()).filter(({ isDefault }) => isDefault)).toHaveLength(1);
  });

  it('stays single when the default is deleted during a change', async () => {
    const first = await create('First');
    const second = await create('Second');
    await create('Third');

    const responses = await Promise.all([remove(first.id), makeDefault(second.id)]);

    expect(responses.map(({ status }) => status)).toEqual([204, 200]);
    expect((await list()).filter(({ isDefault }) => isDefault)).toHaveLength(1);
  });
});

describe('the address limit', () => {
  const fill = (count: number) =>
    db.insert(addresses).values(
      Array.from({ length: count }, () => ({
        ...address,
        phone: '+639171234567',
        userId: firstUserId,
      })),
    );

  let firstUserId: string;

  beforeEach(async () => {
    const [user] = await db.select().from(users).where(eq(users.email, 'customer@example.com'));
    if (!user) throw new Error('Missing test user');
    firstUserId = user.id;
  });

  it('allows 20 and rejects the next', async () => {
    await fill(19);

    await post(address).expect(201);
    const response = await post(address).expect(409);

    expect(response.body.error.message).toBe('You can save up to 20 addresses');
  });

  it('cannot be passed with parallel requests', async () => {
    await fill(18);

    await Promise.all(Array.from({ length: 5 }, () => post(address)));

    expect(await list()).toHaveLength(20);
  });

  it('frees a slot when an address is deleted', async () => {
    await fill(20);
    const [oldest] = await list();

    await remove(oldest?.id ?? missingId).expect(204);

    await post(address).expect(201);
  });
});

describe('reading and updating', () => {
  it('reports list totals', async () => {
    await create();

    const response = await api().get(url).set(bearer(token)).expect(200);

    expect(response.body.meta).toEqual({ page: 1, limit: 20, total: 1 });
  });

  it('updates fields and normalizes the phone number', async () => {
    const created = await create();

    const response = await api()
      .patch(`${url}/${created.id}`)
      .set(bearer(token))
      .send({ city: 'Taguig', phone: '0918 765 4321' })
      .expect(200);

    expect(response.body.data).toMatchObject({
      city: 'Taguig',
      phone: '+639187654321',
      barangay: address.barangay,
      isDefault: true,
    });
  });

  it('clears line2', async () => {
    const created = (await post({ ...address, line2: 'Sunrise Village' }).expect(201)).body.data;

    const response = await api()
      .patch(`${url}/${created.id}`)
      .set(bearer(token))
      .send({ line2: '' })
      .expect(200);

    expect(response.body.data.line2).toBe('');
  });

  it('rejects bad updates', async () => {
    const created = await create();
    const patch = (body: object) =>
      api().patch(`${url}/${created.id}`).set(bearer(token)).send(body);

    await patch({}).expect(400);
    await patch({ phone: '0281234567' }).expect(400);
    await patch({ isDefault: false }).expect(400);
    await patch({ city: '' }).expect(400);
  });

  it('returns 404 for a missing address', async () => {
    await api().get(`${url}/${missingId}`).set(bearer(token)).expect(404);
    await api().patch(`${url}/${missingId}`).set(bearer(token)).send({ city: 'x' }).expect(404);
    await remove(missingId).expect(404);
    await makeDefault(missingId).expect(404);
  });

  it('returns 400 for an invalid id', async () => {
    await api().get(`${url}/nope`).set(bearer(token)).expect(400);
    await makeDefault('nope').expect(400);
  });
});
