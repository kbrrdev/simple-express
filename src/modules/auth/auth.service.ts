import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { sessions, users } from './auth.schema';
import type { RegisterBody } from './auth.validation';

export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_GRACE_PERIOD_MS = 30 * 1000;
const ACCESS_TOKEN_TTL = '15m';

const argon2Async = promisify(argon2);
const argon2Options = { parallelism: 1, tagLength: 32, memory: 19456, passes: 2 };

const publicUser = {
  id: users.id,
  email: users.email,
  role: users.role,
  createdAt: users.createdAt,
};

async function hashPassword(password: string) {
  const nonce = randomBytes(16);
  const key = await argon2Async('argon2id', { ...argon2Options, message: password, nonce });
  return `${nonce.toString('hex')}:${key.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string) {
  const [nonce = '', expected = ''] = stored.split(':');
  const key = await argon2Async('argon2id', {
    ...argon2Options,
    message: password,
    nonce: Buffer.from(nonce, 'hex'),
  });
  return timingSafeEqual(key, Buffer.from(expected, 'hex'));
}

// Checked when the email is unknown, so login timing doesn't reveal which emails exist.
const unknownUserPasswordHash = hashPassword(randomBytes(16).toString('hex'));

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function createRefreshToken() {
  return randomBytes(32).toString('base64url');
}

function createAccessToken(userId: string, sessionId: string) {
  return jwt.sign({ sid: sessionId }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export async function register({ email, password }: RegisterBody) {
  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning(publicUser);

  if (!user) throw new AppError(409, 'Email is already registered');
  return user;
}

export async function login({ email, password }: RegisterBody) {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  const passwordMatches = await verifyPassword(
    password,
    user?.passwordHash ?? (await unknownUserPasswordHash),
  );

  if (!user || !passwordMatches) throw new AppError(401, 'Invalid email or password');

  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, user.id), lte(sessions.expiresAt, new Date())));

  const refreshToken = createRefreshToken();
  const [session] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    })
    .returning({ id: sessions.id });

  if (!session) throw new AppError(500, 'Failed to create session');

  return {
    user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt },
    accessToken: createAccessToken(user.id, session.id),
    refreshToken,
  };
}

/** Each refresh token works once, apart from a short grace period for retries and parallel tabs. */
export async function refresh(refreshToken: string) {
  const now = new Date();
  const tokenHash = hashToken(refreshToken);
  const nextToken = createRefreshToken();
  const activeSession = and(isNull(sessions.revokedAt), gt(sessions.expiresAt, now));

  const [rotated] = await db
    .update(sessions)
    .set({
      refreshTokenHash: hashToken(nextToken),
      previousRefreshTokenHash: tokenHash,
      rotatedAt: now,
    })
    .where(and(eq(sessions.refreshTokenHash, tokenHash), activeSession))
    .returning({ id: sessions.id, userId: sessions.userId });

  const [retried] = rotated
    ? []
    : await db
        .update(sessions)
        .set({ refreshTokenHash: hashToken(nextToken) })
        .where(
          and(
            eq(sessions.previousRefreshTokenHash, tokenHash),
            gt(sessions.rotatedAt, new Date(now.getTime() - REFRESH_GRACE_PERIOD_MS)),
            activeSession,
          ),
        )
        .returning({ id: sessions.id, userId: sessions.userId });

  const session = rotated ?? retried;

  if (!session) {
    // A used token arriving after the grace period suggests it was stolen.
    await db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.previousRefreshTokenHash, tokenHash), isNull(sessions.revokedAt)));

    throw new AppError(401, 'Invalid or expired refresh token');
  }

  return {
    accessToken: createAccessToken(session.userId, session.id),
    refreshToken: nextToken,
  };
}

export async function verifyAccessToken(token: string) {
  let payload: string | jwt.JwtPayload;

  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw new AppError(401, 'Invalid or expired access token');
  }

  if (typeof payload === 'string' || !payload.sub || typeof payload.sid !== 'string') {
    throw new AppError(401, 'Invalid or expired access token');
  }

  const [session] = await db
    .select({ id: sessions.id, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.id, payload.sid),
        eq(sessions.userId, payload.sub),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    );

  if (!session) throw new AppError(401, 'Invalid or expired access token');

  return { userId: payload.sub, sessionId: session.id, role: session.role };
}

export async function logout(sessionId: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function logoutAll(userId: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function getUser(userId: string) {
  const [user] = await db.select(publicUser).from(users).where(eq(users.id, userId));

  if (!user) throw new AppError(401, 'Invalid or expired access token');
  return user;
}
