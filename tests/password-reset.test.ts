import { isNull, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { db, pool } from '../src/db';
import { loginAttempts, passwordResets, sessions } from '../src/db/schema';
import { credentialsLimiter } from '../src/modules/auth/auth.routes';
import { requestPasswordReset } from '../src/modules/auth/auth.service';

const sendEmail = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/email', () => ({ sendEmail }));

const credentials = { email: 'jane@example.com', password: 'correct-horse-battery' };
const newPassword = 'a-brand-new-passphrase';

const api = () => request(app);
const login = (password: string) =>
  api().post('/api/auth/login').send({ email: credentials.email, password, client: 'native' });
const resetPassword = (token: string, password = newPassword) =>
  api().post('/api/auth/reset-password').send({ token, newPassword: password });

function sentToken(call = -1) {
  const text: string = sendEmail.mock.calls.at(call)?.[0].text ?? '';
  const match = /http:\/\/localhost:5173\/reset-password#token=([\w-]+)/.exec(text);

  if (!match?.[1]) throw new Error('No reset link was sent');
  return match[1];
}

beforeEach(async () => {
  await db.execute(sql`truncate table users, sessions, login_attempts cascade`);
  for (const key of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
    await credentialsLimiter.resetKey(key);
  }
  sendEmail.mockReset();
  await api().post('/api/auth/register').send(credentials).expect(201);
});

afterAll(async () => {
  await pool.end();
});

describe('POST /api/auth/forgot-password', () => {
  it('returns 202 and emails a link with the token in the fragment', async () => {
    const response = await api()
      .post('/api/auth/forgot-password')
      .send({ email: ' Jane@Example.com ' });

    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledOnce());
    expect(sendEmail.mock.calls[0]?.[0].to).toBe(credentials.email);

    const [reset] = await db.select().from(passwordResets);
    expect(reset?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(reset?.tokenHash).not.toBe(sentToken());
  });

  it('returns 202 for an unknown email', async () => {
    const response = await api()
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(response.status).toBe(202);
  });

  it('sends nothing for an unknown email', async () => {
    await requestPasswordReset('nobody@example.com');

    expect(sendEmail).not.toHaveBeenCalled();
    expect(await db.select().from(passwordResets)).toHaveLength(0);
  });

  it('rejects an invalid email', async () => {
    const response = await api().post('/api/auth/forgot-password').send({ email: 'nope' });

    expect(response.status).toBe(400);
  });

  it('sends at most three emails an hour per account', async () => {
    for (let i = 0; i < 4; i++) await requestPasswordReset(credentials.email);

    expect(sendEmail).toHaveBeenCalledTimes(3);
  });

  it('allows more emails once the hour has passed', async () => {
    for (let i = 0; i < 3; i++) await requestPasswordReset(credentials.email);
    await db.update(passwordResets).set({ createdAt: new Date(Date.now() - 61 * 60 * 1000) });

    await requestPasswordReset(credentials.email);

    expect(sendEmail).toHaveBeenCalledTimes(4);
  });

  it('is rate limited per IP address', async () => {
    for (let i = 0; i < 10; i++) {
      await api().post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    }

    const response = await api()
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(response.status).toBe(429);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('changes the password, ends every session, and clears failed logins', async () => {
    const { body } = await login(credentials.password).expect(200);
    await db.insert(loginAttempts).values({ email: credentials.email, failedCount: 3 });
    await requestPasswordReset(credentials.email);

    const response = await resetPassword(sentToken());

    expect(response.status).toBe(204);
    await api()
      .get('/api/auth/me')
      .set({ Authorization: `Bearer ${body.data.accessToken}` })
      .expect(401);
    expect(await db.select().from(sessions).where(isNull(sessions.revokedAt))).toEqual([]);
    expect(await db.select().from(loginAttempts)).toEqual([]);
    await login(credentials.password).expect(401);
    await login(newPassword).expect(200);
  });

  it('works only once', async () => {
    await requestPasswordReset(credentials.email);
    const token = sentToken();

    await resetPassword(token).expect(204);
    const response = await resetPassword(token, 'yet-another-passphrase');

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('This reset link is invalid or has expired');
  });

  it('rejects an expired token', async () => {
    await requestPasswordReset(credentials.email);
    await db.update(passwordResets).set({ expiresAt: new Date(Date.now() - 1000) });

    await resetPassword(sentToken()).expect(400);
  });

  it('rejects an older token once a new one is sent', async () => {
    await requestPasswordReset(credentials.email);
    await requestPasswordReset(credentials.email);

    await resetPassword(sentToken(0)).expect(400);
    await resetPassword(sentToken(1)).expect(204);
  });

  it('rejects a made-up token', async () => {
    await resetPassword('made-up-token').expect(400);
  });

  it('rejects a common password without using the token', async () => {
    await requestPasswordReset(credentials.email);

    const response = await resetPassword(sentToken(), 'password1');

    expect(response.status).toBe(400);
    await resetPassword(sentToken()).expect(204);
  });
});
