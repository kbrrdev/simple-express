import { eq, sql } from 'drizzle-orm';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { db, pool } from '../src/db';
import { sessions, users } from '../src/db/schema';
import { errorHandler } from '../src/middleware/error-handler';
import { requireAdmin, requireAuth } from '../src/middleware/require-auth';
import { credentialsLimiter, refreshLimiter } from '../src/modules/auth/auth.routes';
import { REFRESH_GRACE_PERIOD_MS } from '../src/modules/auth/auth.service';

const credentials = { email: 'jane@example.com', password: 'correct-horse-battery' };
const blog = { title: 'Hello', content: 'First post', author: 'Jane' };

const api = () => request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const getMe = (token: string) => api().get('/api/auth/me').set(bearer(token));

async function resetLimits() {
  for (const key of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
    await credentialsLimiter.resetKey(key);
    await refreshLimiter.resetKey(key);
  }
}

async function login(client: 'web' | 'native' = 'native') {
  const response = await api()
    .post('/api/auth/login')
    .send({ ...credentials, client });

  expect(response.status).toBe(200);
  return response;
}

const refresh = (refreshToken: string) => api().post('/api/auth/refresh').send({ refreshToken });

async function endGracePeriod() {
  await db
    .update(sessions)
    .set({ rotatedAt: new Date(Date.now() - REFRESH_GRACE_PERIOD_MS - 1000) });
}

beforeEach(async () => {
  await db.execute(sql`truncate table users, sessions, blogs cascade`);
  await resetLimits();
  await api().post('/api/auth/register').send(credentials).expect(201);
});

afterAll(async () => {
  await pool.end();
});

describe('roles', () => {
  const adminApp = express();
  adminApp.get('/admin', requireAuth, requireAdmin, (_req, res) => {
    res.json({ data: 'ok' });
  });
  adminApp.use(errorHandler);

  const getAdmin = (token: string) => request(adminApp).get('/admin').set(bearer(token));
  const setRole = (role: 'customer' | 'admin') =>
    db.update(users).set({ role }).where(eq(users.email, credentials.email));

  it('makes new users customers', async () => {
    const { body } = await login();
    const me = await getMe(body.data.accessToken);

    expect(body.data.user.role).toBe('customer');
    expect(me.body.data.role).toBe('customer');
  });

  it('does not let a user choose their role when registering', async () => {
    const response = await api()
      .post('/api/auth/register')
      .send({ email: 'sneaky@example.com', password: 'another-password', role: 'admin' });

    expect(response.status).toBe(400);
  });

  it('blocks customers from admin routes', async () => {
    const { body } = await login();
    const response = await getAdmin(body.data.accessToken);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { message: 'Admin access required' } });
  });

  it('requires a token on admin routes', async () => {
    const response = await request(adminApp).get('/admin');

    expect(response.status).toBe(401);
  });

  it('lets admins through', async () => {
    await setRole('admin');
    const { body } = await login();

    expect(body.data.user.role).toBe('admin');
    await getAdmin(body.data.accessToken).expect(200);
  });

  it('applies role changes to access tokens already issued', async () => {
    const { body } = await login();
    await getAdmin(body.data.accessToken).expect(403);

    await setRole('admin');
    await getAdmin(body.data.accessToken).expect(200);

    await setRole('customer');
    await getAdmin(body.data.accessToken).expect(403);
  });
});

describe('register', () => {
  it('returns the user without any password data', async () => {
    const response = await api()
      .post('/api/auth/register')
      .send({ email: 'New@Example.com', password: 'another-password' });

    expect(response.status).toBe(201);
    expect(response.body.data.email).toBe('new@example.com');
    expect(Object.keys(response.body.data).sort()).toEqual(['createdAt', 'email', 'id', 'role']);
  });

  it('stores a salted hash instead of the password', async () => {
    await api()
      .post('/api/auth/register')
      .send({ email: 'two@example.com', password: credentials.password });

    const rows = await db.select({ hash: users.passwordHash }).from(users);

    expect(rows[0]?.hash).not.toContain(credentials.password);
    expect(rows[0]?.hash).not.toBe(rows[1]?.hash);
  });

  it('rejects a duplicate email regardless of case', async () => {
    const response = await api()
      .post('/api/auth/register')
      .send({ ...credentials, email: 'JANE@example.com' });

    expect(response.status).toBe(409);
  });

  it('rejects an invalid email or short password', async () => {
    const response = await api()
      .post('/api/auth/register')
      .send({ email: 'nope', password: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toHaveLength(2);
  });
});

describe('login', () => {
  it('returns the refresh token in the body for native clients', async () => {
    const response = await login('native');

    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.refreshToken).toEqual(expect.any(String));
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('keeps the refresh token out of the body for web clients', async () => {
    const response = await login('web');
    const [cookie] = response.get('Set-Cookie') ?? [];

    expect(response.body.data.refreshToken).toBeUndefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/auth');
  });

  it('stores only a hash of the refresh token', async () => {
    const { refreshToken } = (await login()).body.data;
    const [session] = await db.select().from(sessions);

    expect(session?.refreshTokenHash).not.toBe(refreshToken);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const wrongPassword = await api()
      .post('/api/auth/login')
      .send({ ...credentials, password: 'wrong-password', client: 'native' });
    const unknownEmail = await api()
      .post('/api/auth/login')
      .send({ ...credentials, email: 'nobody@example.com', client: 'native' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it('requires the client type', async () => {
    await api().post('/api/auth/login').send(credentials).expect(400);
  });
});

describe('access tokens', () => {
  it('identifies the user', async () => {
    const { accessToken } = (await login()).body.data;
    const response = await getMe(accessToken);

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(credentials.email);
    expect(response.body.data.passwordHash).toBeUndefined();
  });

  it('rejects a missing token and a non-bearer scheme', async () => {
    await api().get('/api/auth/me').expect(401);
    await api().get('/api/auth/me').set('Authorization', 'Basic abc').expect(401);
  });

  it('rejects an expired token', async () => {
    const { accessToken } = (await login()).body.data;
    const { sub, sid } = jwt.decode(accessToken) as jwt.JwtPayload;
    const expired = jwt.sign({ sid }, env.JWT_SECRET, { subject: sub, expiresIn: -1 });

    await getMe(expired).expect(401);
  });

  it('rejects a tampered token', async () => {
    const { accessToken } = (await login()).body.data;
    const [header, , signature] = accessToken.split('.');
    const payload = Buffer.from(JSON.stringify({ sub: 'someone-else' })).toString('base64url');

    await getMe(`${header}.${payload}.${signature}`).expect(401);
  });

  it('rejects a token signed with another secret', async () => {
    const { accessToken } = (await login()).body.data;
    const { sub, sid } = jwt.decode(accessToken) as jwt.JwtPayload;
    const forged = jwt.sign({ sid }, 'another-secret-of-at-least-32-characters', { subject: sub });

    await getMe(forged).expect(401);
  });

  it('rejects a validly signed token whose user does not own the session', async () => {
    const { accessToken } = (await login()).body.data;
    const { sid } = jwt.decode(accessToken) as jwt.JwtPayload;
    const other = await api()
      .post('/api/auth/register')
      .send({ email: 'other@example.com', password: 'another-password' });
    const mismatched = jwt.sign({ sid }, env.JWT_SECRET, { subject: other.body.data.id });

    await getMe(mismatched).expect(401);
  });

  it('rejects an unsigned alg none token', async () => {
    const { accessToken } = (await login()).body.data;
    const { sub, sid } = jwt.decode(accessToken) as jwt.JwtPayload;
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub, sid })}.`;

    await getMe(unsigned).expect(401);
  });
});

describe('revocation', () => {
  it('rejects an unexpired access token immediately after logout', async () => {
    const { accessToken } = (await login()).body.data;

    await getMe(accessToken).expect(200);
    await api().post('/api/auth/logout').set(bearer(accessToken)).expect(204);
    await getMe(accessToken).expect(401);
  });

  it('logs out one device and leaves the others working', async () => {
    const phone = (await login()).body.data;
    const laptop = (await login()).body.data;

    await api().post('/api/auth/logout').set(bearer(phone.accessToken)).expect(204);

    await getMe(phone.accessToken).expect(401);
    await getMe(laptop.accessToken).expect(200);
    await refresh(phone.refreshToken).expect(401);
    await refresh(laptop.refreshToken).expect(200);
  });

  it('ends every session on logout-all', async () => {
    const phone = (await login()).body.data;
    const laptop = (await login()).body.data;

    await api().post('/api/auth/logout-all').set(bearer(phone.accessToken)).expect(204);

    await getMe(phone.accessToken).expect(401);
    await getMe(laptop.accessToken).expect(401);
    await refresh(laptop.refreshToken).expect(401);
  });

  it("does not affect another user's sessions", async () => {
    const other = { email: 'other@example.com', password: 'another-password' };
    await api().post('/api/auth/register').send(other).expect(201);
    const otherLogin = await api()
      .post('/api/auth/login')
      .send({ ...other, client: 'native' });
    const { accessToken } = (await login()).body.data;

    await api().post('/api/auth/logout-all').set(bearer(accessToken)).expect(204);

    await getMe(otherLogin.body.data.accessToken).expect(200);
  });

  it('rejects a session that has expired', async () => {
    const { accessToken, refreshToken } = (await login()).body.data;

    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });

    await getMe(accessToken).expect(401);
    await refresh(refreshToken).expect(401);
  });
});

describe('refresh', () => {
  it('issues new working tokens and rotates the refresh token', async () => {
    const first = (await login()).body.data;
    const response = await refresh(first.refreshToken);

    expect(response.status).toBe(200);
    expect(response.body.data.refreshToken).not.toBe(first.refreshToken);
    await getMe(response.body.data.accessToken).expect(200);
    await refresh(response.body.data.refreshToken).expect(200);
  });

  it('allows a retry of the old token inside the grace period', async () => {
    const first = (await login()).body.data;

    await refresh(first.refreshToken).expect(200);
    const retried = await refresh(first.refreshToken);

    expect(retried.status).toBe(200);
    await refresh(retried.body.data.refreshToken).expect(200);
  });

  it('handles parallel refreshes without ending the session', async () => {
    const first = (await login()).body.data;

    const responses = await Promise.all([
      refresh(first.refreshToken),
      refresh(first.refreshToken),
      refresh(first.refreshToken),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200]);
    await getMe(first.accessToken).expect(200);
  });

  it('revokes the session when an old token is reused after the grace period', async () => {
    const first = (await login()).body.data;
    const second = (await refresh(first.refreshToken)).body.data;

    await endGracePeriod();

    await refresh(first.refreshToken).expect(401);
    await getMe(second.accessToken).expect(401);
    await refresh(second.refreshToken).expect(401);
  });

  it('rejects an unknown or missing token', async () => {
    await refresh('not-a-real-token').expect(401);
    await api().post('/api/auth/refresh').expect(401);
  });

  it('rotates the cookie for web clients', async () => {
    const [cookie = ''] = (await login('web')).get('Set-Cookie') ?? [];
    const response = await api()
      .post('/api/auth/refresh')
      .set('Cookie', cookie.split(';')[0] ?? '');
    const [rotated = ''] = response.get('Set-Cookie') ?? [];

    expect(response.status).toBe(200);
    expect(response.body.data.refreshToken).toBeUndefined();
    expect(rotated).toContain('HttpOnly');
    expect(rotated.split(';')[0]).not.toBe(cookie.split(';')[0]);
  });

  it('clears the cookie on logout', async () => {
    const response = await login('web');
    const logout = await api().post('/api/auth/logout').set(bearer(response.body.data.accessToken));
    const [cleared] = logout.get('Set-Cookie') ?? [];

    expect(cleared).toContain('refreshToken=;');
    expect(cleared).toContain('Path=/api/auth');
  });
});

describe('blogs', () => {
  it('keeps reads public', async () => {
    await api().get('/api/blogs').expect(200);
  });

  it('requires a token to create, update and delete', async () => {
    await db.update(users).set({ role: 'admin' }).where(eq(users.email, credentials.email));
    const { accessToken } = (await login()).body.data;
    const created = await api().post('/api/blogs').set(bearer(accessToken)).send(blog).expect(201);
    const path = `/api/blogs/${created.body.data.id}`;

    await api().post('/api/blogs').send(blog).expect(401);
    await api().patch(path).send({ title: 'Changed' }).expect(401);
    await api().delete(path).expect(401);

    await api().patch(path).set(bearer(accessToken)).send({ title: 'Changed' }).expect(200);
    await api().delete(path).set(bearer(accessToken)).expect(204);
  });

  it('rejects a revoked token on writes', async () => {
    const { accessToken } = (await login()).body.data;

    await api().post('/api/auth/logout').set(bearer(accessToken)).expect(204);
    await api().post('/api/blogs').set(bearer(accessToken)).send(blog).expect(401);
  });
});

describe('protection', () => {
  it('rate limits repeated login attempts', async () => {
    await resetLimits();
    const attempt = () =>
      api()
        .post('/api/auth/login')
        .send({ ...credentials, password: 'wrong-password', client: 'native' });

    for (let i = 0; i < 10; i++) {
      await attempt().expect(401);
    }

    const limited = await attempt();

    expect(limited.status).toBe(429);
    expect(limited.body.error.message).toEqual(expect.any(String));
  });

  it('allows credentials from listed origins only', async () => {
    const allowed = await api().get('/health').set('Origin', 'http://localhost:5173');
    const blocked = await api().get('/health').set('Origin', 'http://evil.test');

    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});
