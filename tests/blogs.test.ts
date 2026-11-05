import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { db, pool } from '../src/db';
import { blogs, users } from '../src/db/schema';

const password = 'correct-horse-battery';
const blog = { title: 'Hello', content: 'First post', author: 'Jane' };
const missingId = '00000000-0000-4000-8000-000000000000';

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminToken: string;
let ownerToken: string;
let otherToken: string;

async function registerAndLogin(email: string) {
  await api().post('/api/auth/register').send({ email, password }).expect(201);
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password, client: 'native' })
    .expect(200);

  return response.body.data.accessToken as string;
}

async function createBlog(token: string) {
  const response = await api().post('/api/blogs').set(bearer(token)).send(blog).expect(201);
  return response.body.data;
}

beforeAll(async () => {
  await db.execute(sql`truncate table users, sessions cascade`);

  adminToken = await registerAndLogin('admin@example.com');
  await db.update(users).set({ role: 'admin' }).where(eq(users.email, 'admin@example.com'));
  ownerToken = await registerAndLogin('owner@example.com');
  otherToken = await registerAndLogin('other@example.com');
});

beforeEach(async () => {
  await db.delete(blogs);
});

afterEach(() => {
  env.BLOG_CUSTOMER_WRITES_ENABLED = true;
});

afterAll(async () => {
  await pool.end();
});

describe('blog ownership', () => {
  it('makes the creator the owner', async () => {
    const [owner] = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    const created = await createBlog(ownerToken);

    expect(created.authorId).toBe(owner?.id);
  });

  it('does not let a user set the owner', async () => {
    await api()
      .post('/api/blogs')
      .set(bearer(ownerToken))
      .send({ ...blog, authorId: missingId })
      .expect(400);

    const created = await createBlog(ownerToken);

    await api()
      .patch(`/api/blogs/${created.id}`)
      .set(bearer(ownerToken))
      .send({ authorId: missingId })
      .expect(400);
  });

  it('lets customers change their own blogs', async () => {
    const created = await createBlog(ownerToken);
    const path = `/api/blogs/${created.id}`;

    await api().patch(path).set(bearer(ownerToken)).send({ title: 'Changed' }).expect(200);
    await api().delete(path).set(bearer(ownerToken)).expect(204);
  });

  it("stops customers changing someone else's blog", async () => {
    const created = await createBlog(ownerToken);
    const path = `/api/blogs/${created.id}`;

    await api().patch(path).set(bearer(otherToken)).send({ title: 'Changed' }).expect(403);
    await api().delete(path).set(bearer(otherToken)).expect(403);

    const response = await api().get(path).expect(200);

    expect(response.body.data.title).toBe(blog.title);
  });

  it('lets admins change any blog', async () => {
    const created = await createBlog(ownerToken);
    const path = `/api/blogs/${created.id}`;

    await api().patch(path).set(bearer(adminToken)).send({ title: 'Changed' }).expect(200);
    await api().delete(path).set(bearer(adminToken)).expect(204);
  });

  it('only lets admins change a blog with no owner', async () => {
    const [created] = await db.insert(blogs).values(blog).returning();
    const path = `/api/blogs/${created?.id}`;

    await api().patch(path).set(bearer(ownerToken)).send({ title: 'Changed' }).expect(403);
    await api().patch(path).set(bearer(adminToken)).send({ title: 'Changed' }).expect(200);
  });

  it('returns 404 for a missing blog', async () => {
    const path = `/api/blogs/${missingId}`;

    await api().patch(path).set(bearer(ownerToken)).send({ title: 'Changed' }).expect(404);
    await api().delete(path).set(bearer(ownerToken)).expect(404);
  });
});

describe('with customer writes disabled', () => {
  beforeEach(() => {
    env.BLOG_CUSTOMER_WRITES_ENABLED = false;
  });

  it('blocks customers from creating blogs', async () => {
    const response = await api().post('/api/blogs').set(bearer(ownerToken)).send(blog);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { message: 'Only admins can write blogs' } });
  });

  it('blocks customers from changing blogs they already own', async () => {
    env.BLOG_CUSTOMER_WRITES_ENABLED = true;
    const created = await createBlog(ownerToken);
    const path = `/api/blogs/${created.id}`;
    env.BLOG_CUSTOMER_WRITES_ENABLED = false;

    await api().patch(path).set(bearer(ownerToken)).send({ title: 'Changed' }).expect(403);
    await api().delete(path).set(bearer(ownerToken)).expect(403);
  });

  it('still lets admins write', async () => {
    const created = await createBlog(adminToken);
    const path = `/api/blogs/${created.id}`;

    await api().patch(path).set(bearer(adminToken)).send({ title: 'Changed' }).expect(200);
    await api().delete(path).set(bearer(adminToken)).expect(204);
  });

  it('keeps blogs public to read', async () => {
    const created = await createBlog(adminToken);

    await api().get('/api/blogs').expect(200);
    await api().get(`/api/blogs/${created.id}`).expect(200);
  });

  it('still requires a token', async () => {
    await api().post('/api/blogs').send(blog).expect(401);
  });
});
