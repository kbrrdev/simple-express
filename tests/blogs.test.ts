import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import { blogs, users } from '../src/db/schema';

const password = 'correct-horse-battery';
const blog = { title: 'Hello', content: 'First post', author: 'Jane' };
const missingId = '00000000-0000-4000-8000-000000000000';

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminToken: string;
let customerToken: string;

async function registerAndLogin(email: string) {
  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

async function createBlog() {
  const response = await api().post('/api/blogs').set(bearer(adminToken)).send(blog).expect(201);
  return response.body.data;
}

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  adminToken = await registerAndLogin('admin@example.com');
  await db.update(users).set({ role: 'admin' }).where(eq(users.email, 'admin@example.com'));
  customerToken = await registerAndLogin('customer@example.com');
});

beforeEach(async () => {
  await db.delete(blogs);
});

afterAll(async () => {
  await pool.end();
});

describe('blogs', () => {
  it('is public to read', async () => {
    const created = await createBlog();

    await api().get('/api/blogs').expect(200);
    await api().get(`/api/blogs/${created.id}`).expect(200);
  });

  it('lets admins create, update and delete', async () => {
    const created = await createBlog();
    const path = `/api/blogs/${created.id}`;

    await api().patch(path).set(bearer(adminToken)).send({ title: 'Changed' }).expect(200);
    await api().delete(path).set(bearer(adminToken)).expect(204);
  });

  it('blocks customers from writing', async () => {
    const created = await createBlog();
    const path = `/api/blogs/${created.id}`;

    const response = await api().post('/api/blogs').set(bearer(customerToken)).send(blog);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { message: 'Admin access required' } });
    await api().patch(path).set(bearer(customerToken)).send({ title: 'Changed' }).expect(403);
    await api().delete(path).set(bearer(customerToken)).expect(403);

    const unchanged = await api().get(path).expect(200);

    expect(unchanged.body.data.title).toBe(blog.title);
  });

  it('requires a token to write', async () => {
    const created = await createBlog();
    const path = `/api/blogs/${created.id}`;

    await api().post('/api/blogs').send(blog).expect(401);
    await api().patch(path).send({ title: 'Changed' }).expect(401);
    await api().delete(path).expect(401);
  });

  it('does not store or accept an owner', async () => {
    const created = await createBlog();

    expect(created).not.toHaveProperty('authorId');
    await api()
      .post('/api/blogs')
      .set(bearer(adminToken))
      .send({ ...blog, authorId: missingId })
      .expect(400);
  });

  it('returns 404 for a missing blog', async () => {
    const path = `/api/blogs/${missingId}`;

    await api().patch(path).set(bearer(adminToken)).send({ title: 'Changed' }).expect(404);
    await api().delete(path).set(bearer(adminToken)).expect(404);
  });
});
