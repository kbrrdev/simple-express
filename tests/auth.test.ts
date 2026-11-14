import { createHmac } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { db, pool } from '../src/db';
import { loginAttempts, roles, sessions, SUPER_ADMIN_ROLE_ID, users } from '../src/db/schema';
import { errorHandler } from '../src/middleware/error-handler';
import { requireAuth, requirePermission, requireSuperAdmin } from '../src/middleware/require-auth';
import { credentialsLimiter, refreshLimiter } from '../src/modules/auth/auth.routes';
import { REFRESH_GRACE_PERIOD_MS } from '../src/modules/auth/auth.service';
import { allPermissions } from '../src/modules/roles/permissions';

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
  await db.execute(sql`truncate table users, sessions, blogs, login_attempts cascade`);
  await resetLimits();
  await api().post('/api/auth/register').send(credentials).expect(201);
});

afterAll(async () => {
  await pool.end();
});

describe('roles', () => {
  const adminApp = express();
  adminApp.get('/orders', requireAuth, requirePermission('orders.view'), (_req, res) => {
    res.json({ data: 'ok' });
  });
  adminApp.get('/roles', requireAuth, requireSuperAdmin, (_req, res) => {
    res.json({ data: 'ok' });
  });
  adminApp.use(errorHandler);

  const getOrders = (token: string) => request(adminApp).get('/orders').set(bearer(token));
  const getRoles = (token: string) => request(adminApp).get('/roles').set(bearer(token));
  const setRole = (roleId: string | null) =>
    db.update(users).set({ roleId }).where(eq(users.email, credentials.email));

  async function staffRoleId() {
    const [role] = await db.select().from(roles).where(eq(roles.name, 'Staff'));
    if (!role) throw new Error('Failed to find the Staff role');
    return role.id;
  }

  it('makes new users customers, with no permissions', async () => {
    const { body } = await login();
    const me = await getMe(body.data.accessToken);

    expect(body.data.user).toMatchObject({ role: null, permissions: [] });
    expect(me.body.data).toMatchObject({ role: null, permissions: [] });
  });

  it('does not let a user choose their role when registering', async () => {
    const response = await api().post('/api/auth/register').send({
      email: 'sneaky@example.com',
      password: 'another-password',
      roleId: SUPER_ADMIN_ROLE_ID,
    });

    expect(response.status).toBe(400);
  });

  it('blocks users without the permission', async () => {
    const { body } = await login();
    const response = await getOrders(body.data.accessToken);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { message: 'You do not have permission to do this' } });
  });

  it('requires a token', async () => {
    await request(adminApp).get('/orders').expect(401);
  });

  it('lets a role through with its permissions only', async () => {
    await setRole(await staffRoleId());
    const { body } = await login();

    expect(body.data.user.role.name).toBe('Staff');
    expect(body.data.user.permissions).toContain('orders.view');
    expect(body.data.user.permissions).not.toContain('orders.refund');
    await getOrders(body.data.accessToken).expect(200);
    await getRoles(body.data.accessToken).expect(403);
  });

  it('gives super admins every permission', async () => {
    await setRole(SUPER_ADMIN_ROLE_ID);
    const { body } = await login();

    expect(body.data.user.permissions).toEqual(allPermissions);
    await getOrders(body.data.accessToken).expect(200);
    await getRoles(body.data.accessToken).expect(200);
  });

  it('applies role changes to access tokens already issued', async () => {
    const { body } = await login();
    await getOrders(body.data.accessToken).expect(403);

    await setRole(await staffRoleId());
    await getOrders(body.data.accessToken).expect(200);

    await setRole(null);
    await getOrders(body.data.accessToken).expect(403);
  });
});

describe('register', () => {
  it('returns the user without any password data', async () => {
    const response = await api()
      .post('/api/auth/register')
      .send({ email: 'New@Example.com', password: 'another-password' });

    expect(response.status).toBe(201);
    expect(response.body.data.email).toBe('new@example.com');
    expect(Object.keys(response.body.data).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'permissions',
      'role',
      'superAdmin',
    ]);
  });

  it('records when the customer accepted the terms', async () => {
    await api()
      .post('/api/auth/register')
      .send({ email: 'terms@example.com', password: 'another-password', acceptTerms: true })
      .expect(201);
    await api()
      .post('/api/auth/register')
      .send({ email: 'no-terms@example.com', password: 'another-password' })
      .expect(201);

    const rows = await db
      .select({ email: users.email, termsAcceptedAt: users.termsAcceptedAt })
      .from(users)
      .where(inArray(users.email, ['terms@example.com', 'no-terms@example.com']));
    const acceptedAt = Object.fromEntries(rows.map((row) => [row.email, row.termsAcceptedAt]));

    expect(acceptedAt['terms@example.com']).toBeInstanceOf(Date);
    expect(acceptedAt['no-terms@example.com']).toBeNull();
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

describe('refresh token reuse', () => {
  it('revokes the session when a token from two rotations ago is replayed', async () => {
    const first = (await login()).body.data.refreshToken;
    const second = (await refresh(first).expect(200)).body.data;
    const third = (await refresh(second.refreshToken).expect(200)).body.data;

    await refresh(first).expect(401);

    await getMe(third.accessToken).expect(401);
    await refresh(third.refreshToken).expect(401);
  });

  it('only revokes the session the token belongs to', async () => {
    const stolen = (await login()).body.data.refreshToken;
    const otherDevice = (await login()).body.data;
    const next = (await refresh(stolen).expect(200)).body.data;
    await refresh(next.refreshToken).expect(200);

    await refresh(stolen).expect(401);

    await getMe(otherDevice.accessToken).expect(200);
  });

  it('does not let a forged token revoke a session', async () => {
    const token: string = (await login()).body.data.refreshToken;
    const [sessionId, secret, signature] = token.split('.');

    await refresh(`${sessionId}.made-up-secret.${signature}`).expect(401);
    await refresh(`${sessionId}.${secret}.bad-signature`).expect(401);
    await refresh(sessionId ?? '').expect(401);

    await refresh(token).expect(200);
  });

  it('rejects a token that was signed with another secret', async () => {
    const token: string = (await login()).body.data.refreshToken;
    const [sessionId, secret] = token.split('.');
    const value = `${sessionId}.${secret}`;
    const signature = createHmac('sha256', 'another-secret-of-at-least-32-characters')
      .update(`refresh-token:${value}`)
      .digest('base64url');

    await refresh(`${value}.${signature}`).expect(401);
    await refresh(token).expect(200);
  });

  it('keeps sessions separate from the refresh token value', async () => {
    const response = await login();
    const [row] = await db.select().from(sessions);

    expect(row?.refreshTokenHash).not.toContain(response.body.data.refreshToken);
    expect(response.body.data.refreshToken.startsWith(`${row?.id}.`)).toBe(true);
  });
});

describe('failed logins for one account', () => {
  const wrongLogin = (email = credentials.email) =>
    api().post('/api/auth/login').send({ email, password: 'wrong-password', client: 'native' });

  const rightLogin = () =>
    api()
      .post('/api/auth/login')
      .send({ ...credentials, client: 'native' });

  const failFiveTimes = async (email?: string) => {
    for (let i = 0; i < 5; i++) {
      await wrongLogin(email).expect(401);
    }
  };

  const delaySeconds = async (email = credentials.email) => {
    const [row] = await db.select().from(loginAttempts).where(eq(loginAttempts.email, email));
    return Math.round(((row?.blockedUntil?.getTime() ?? 0) - Date.now()) / 1000);
  };

  const endDelay = () =>
    db.update(loginAttempts).set({ blockedUntil: new Date(Date.now() - 1000) });

  it('allows four failures', async () => {
    for (let i = 0; i < 4; i++) {
      await wrongLogin().expect(401);
    }

    expect(await delaySeconds()).toBeLessThanOrEqual(0);
    await rightLogin().expect(200);
  });

  it('delays the account after five, even with the right password', async () => {
    await failFiveTimes();

    const response = await rightLogin();

    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: { message: 'Too many requests, try again later' } });
    expect(await delaySeconds()).toBeGreaterThan(20);
  });

  it('treats an unknown email the same, so it reveals nothing', async () => {
    await failFiveTimes('nobody@example.com');

    await wrongLogin('nobody@example.com').expect(429);
  });

  it('does not affect other accounts', async () => {
    await failFiveTimes('nobody@example.com');

    await rightLogin().expect(200);
  });

  it('allows logging in once the delay ends, and clears the record', async () => {
    await failFiveTimes();
    await endDelay();

    await rightLogin().expect(200);

    expect(await db.select().from(loginAttempts)).toEqual([]);
  });

  it('doubles the delay up to five minutes', async () => {
    await failFiveTimes();
    const delays = [await delaySeconds()];

    for (let i = 0; i < 6; i++) {
      await resetLimits();
      await endDelay();
      await wrongLogin().expect(401);
      delays.push(await delaySeconds());
    }

    expect(delays).toEqual([30, 60, 120, 240, 300, 300, 300]);
  });

  it('forgets failures after a quiet period', async () => {
    await failFiveTimes();
    await db.update(loginAttempts).set({
      lastFailedAt: new Date(Date.now() - 16 * 60 * 1000),
      blockedUntil: new Date(Date.now() - 1000),
    });

    await wrongLogin().expect(401);

    const [row] = await db.select().from(loginAttempts);

    expect(row?.failedCount).toBe(1);
  });
});

describe('common passwords', () => {
  it.each(['password', 'Password', '12345678', 'qwertyuiop'])('rejects %s', async (password) => {
    const response = await api()
      .post('/api/auth/register')
      .send({ email: 'new@example.com', password });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toBe('This password is too common');
  });

  it('still lets existing accounts log in', async () => {
    const passwordHash = (await db.select().from(users))[0]?.passwordHash ?? '';
    await db.insert(users).values({ email: 'old@example.com', passwordHash });

    await api()
      .post('/api/auth/login')
      .send({ ...credentials, email: 'old@example.com', client: 'native' })
      .expect(200);
  });
});

describe('changing a password', () => {
  const newPassword = 'another-long-passphrase';

  const change = (token: string, body: object) =>
    api().post('/api/auth/change-password').set(bearer(token)).send(body);

  it('requires a token', async () => {
    await api()
      .post('/api/auth/change-password')
      .send({ currentPassword: credentials.password, newPassword })
      .expect(401);
  });

  it('replaces the password', async () => {
    const { accessToken } = (await login()).body.data;

    await change(accessToken, { currentPassword: credentials.password, newPassword }).expect(204);

    await api()
      .post('/api/auth/login')
      .send({ ...credentials, client: 'native' })
      .expect(401);
    await api()
      .post('/api/auth/login')
      .send({ ...credentials, password: newPassword, client: 'native' })
      .expect(200);
  });

  it('keeps this session and ends the others', async () => {
    const current = (await login()).body.data;
    const other = (await login()).body.data;

    await change(current.accessToken, {
      currentPassword: credentials.password,
      newPassword,
    }).expect(204);

    await getMe(current.accessToken).expect(200);
    await getMe(other.accessToken).expect(401);
    await refresh(other.refreshToken).expect(401);
    await refresh(current.refreshToken).expect(200);
  });

  it('does not affect other users', async () => {
    const other = { email: 'other@example.com', password: 'another-password' };
    await api().post('/api/auth/register').send(other).expect(201);
    const otherLogin = await api()
      .post('/api/auth/login')
      .send({ ...other, client: 'native' })
      .expect(200);
    const { accessToken } = (await login()).body.data;

    await change(accessToken, { currentPassword: credentials.password, newPassword }).expect(204);

    await getMe(otherLogin.body.data.accessToken).expect(200);
  });

  it('rejects a wrong current password and changes nothing', async () => {
    const { accessToken } = (await login()).body.data;

    const response = await change(accessToken, {
      currentPassword: 'wrong-password',
      newPassword,
    }).expect(400);

    expect(response.body.error.message).toBe('Current password is incorrect');
    await login();
  });

  it('rejects the same, common or short passwords', async () => {
    const { accessToken } = (await login()).body.data;
    const currentPassword = credentials.password;

    await change(accessToken, { currentPassword, newPassword: currentPassword }).expect(400);
    await change(accessToken, { currentPassword, newPassword: 'password' }).expect(400);
    await change(accessToken, { currentPassword, newPassword: 'short' }).expect(400);
  });
});

describe('blogs', () => {
  it('keeps reads public', async () => {
    await api().get('/api/blogs').expect(200);
  });

  it('requires a token to create, update and delete', async () => {
    await db
      .update(users)
      .set({ roleId: SUPER_ADMIN_ROLE_ID })
      .where(eq(users.email, credentials.email));
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
    const attempt = (index: number) =>
      api()
        .post('/api/auth/login')
        .send({ email: `user${index}@example.com`, password: 'wrong-password', client: 'native' });

    for (let i = 0; i < 10; i++) {
      await attempt(i).expect(401);
    }

    const limited = await attempt(10);

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
