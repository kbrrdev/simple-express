import {
  argon2,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { and, count, eq, gt, isNull, lte, ne, sql } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { sendEmail } from '../../lib/email';
import { logger } from '../../lib/logger';
import { recordAudit } from '../audit-logs/audit-log.service';
import { resolvePermissions, type Permission } from '../roles/permissions';
import { roles, SUPER_ADMIN_ROLE_ID } from '../roles/role.schema';
import { loginAttempts, passwordResets, sessions, users } from './auth.schema';
import type {
  ChangePasswordBody,
  LoginBody,
  RegisterBody,
  ResetPasswordBody,
} from './auth.validation';

export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_GRACE_PERIOD_MS = 30 * 1000;
const ACCESS_TOKEN_TTL = '15m';

const FREE_LOGIN_ATTEMPTS = 5;
const FIRST_LOGIN_DELAY_SECONDS = 30;
const MAX_LOGIN_DELAY_SECONDS = 300;

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const MAX_RESET_EMAILS_PER_HOUR = 3;
const ONE_HOUR_MS = 60 * 60 * 1000;

const argon2Async = promisify(argon2);
const argon2Options = { parallelism: 1, tagLength: 32, memory: 19456, passes: 2 };

const publicUser = {
  id: users.id,
  email: users.email,
  createdAt: users.createdAt,
};

/**
 * The permissions of the user's role, read in the same query as the user. The names are
 * written out, as Drizzle leaves out table names when a query reads one table, and a bare
 * `role_id` would then match the subquery's own column and grant every role's permissions.
 */
const grantedPermissions = sql<Permission[] | null>`(
  select array_agg(rp.permission) from role_permissions rp where rp.role_id = "users"."role_id"
)`;

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

function signRefreshToken(value: string) {
  return createHmac('sha256', env.JWT_SECRET).update(`refresh-token:${value}`).digest('base64url');
}

/** Holds the session ID, so that any replayed token can be traced back to its session. */
function createRefreshToken(sessionId: string) {
  const value = `${sessionId}.${randomBytes(32).toString('base64url')}`;
  return `${value}.${signRefreshToken(value)}`;
}

/** The signature stops a made-up token from revoking a session whose ID is known. */
function readSessionId(token: string) {
  const [sessionId, secret, signature = ''] = token.split('.');
  const expected = Buffer.from(signRefreshToken(`${sessionId}.${secret}`));
  const actual = Buffer.from(signature);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;
  return sessionId;
}

function createAccessToken(userId: string, sessionId: string) {
  return jwt.sign({ sid: sessionId }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export async function register({ email, password, acceptTerms }: RegisterBody) {
  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, termsAcceptedAt: acceptTerms ? new Date() : null })
    .onConflictDoNothing({ target: users.email })
    .returning(publicUser);

  if (!user) throw new AppError(409, 'Email is already registered');
  return { ...user, role: null, superAdmin: false, permissions: [] };
}

async function assertLoginAllowed(email: string) {
  const [blocked] = await db
    .select({ email: loginAttempts.email })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), sql`${loginAttempts.blockedUntil} > now()`));

  if (blocked) {
    logger.warn('Login delayed after repeated failures');
    throw new AppError(429, 'Too many requests, try again later');
  }
}

/** Delays double after the free attempts. A quiet 15 minutes clears the record. */
async function recordFailedLogin(email: string) {
  const failedCount = sql`${loginAttempts.failedCount} + 1`;
  const delaySeconds = sql`least(
    ${MAX_LOGIN_DELAY_SECONDS}::int,
    ${FIRST_LOGIN_DELAY_SECONDS}::int * power(2, ${failedCount} - ${FREE_LOGIN_ATTEMPTS}::int)
  )`;

  await db
    .delete(loginAttempts)
    .where(sql`${loginAttempts.lastFailedAt} <= now() - interval '15 minutes'`);

  await db
    .insert(loginAttempts)
    .values({ email })
    .onConflictDoUpdate({
      target: loginAttempts.email,
      set: {
        failedCount,
        lastFailedAt: sql`now()`,
        blockedUntil: sql`case when ${failedCount} >= ${FREE_LOGIN_ATTEMPTS}::int
          then now() + make_interval(secs => ${delaySeconds}) end`,
      },
    });
}

export async function login({ email, password }: LoginBody) {
  await assertLoginAllowed(email);

  const [user] = await db.select().from(users).where(eq(users.email, email));
  const passwordMatches = await verifyPassword(
    password,
    user?.passwordHash ?? (await unknownUserPasswordHash),
  );

  if (!user || !passwordMatches) {
    await recordFailedLogin(email);
    throw new AppError(401, 'Invalid email or password');
  }

  await db.delete(loginAttempts).where(eq(loginAttempts.email, email));

  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, user.id), lte(sessions.expiresAt, new Date())));

  const sessionId = randomUUID();
  const refreshToken = createRefreshToken(sessionId);
  const [session] = await db
    .insert(sessions)
    .values({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    })
    .returning({ id: sessions.id });

  if (!session) throw new AppError(500, 'Failed to create session');

  return {
    user: await getUser(user.id),
    accessToken: createAccessToken(user.id, session.id),
    refreshToken,
  };
}

/** Each refresh token works once, apart from a short grace period for retries and parallel tabs. */
export async function refresh(refreshToken: string) {
  const sessionId = readSessionId(refreshToken);

  if (!sessionId) throw new AppError(401, 'Invalid or expired refresh token');

  const now = new Date();
  const tokenHash = hashToken(refreshToken);
  const nextToken = createRefreshToken(sessionId);
  const activeSession = and(
    eq(sessions.id, sessionId),
    isNull(sessions.revokedAt),
    gt(sessions.expiresAt, now),
  );

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
    // A correctly signed token that is no longer current has been used before, which suggests theft.
    const revoked = await db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .returning({ userId: sessions.userId });

    if (revoked[0]) {
      logger.warn(
        { sessionId, sessionUserId: revoked[0].userId },
        'Refresh token reused, session revoked',
      );
    }

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
    .select({ id: sessions.id, roleId: users.roleId, permissions: grantedPermissions })
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

  return {
    userId: payload.sub,
    sessionId: session.id,
    roleId: session.roleId,
    permissions: resolvePermissions(session.roleId, session.permissions),
  };
}

export async function logout(sessionId: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function logoutAll(userId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    await recordAudit(tx, { entityType: 'user', entityId: userId, action: 'sessions_revoke' });
  });
}

/** Ends the user's other sessions, in case the password was changed because of a leak. */
export async function changePassword(
  userId: string,
  sessionId: string,
  { currentPassword, newPassword }: ChangePasswordBody,
) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  if (!user) throw new AppError(401, 'Invalid or expired access token');

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError(400, 'Current password is incorrect');
  }

  if (currentPassword === newPassword) {
    throw new AppError(400, 'New password must be different');
  }

  const passwordHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(sessions.userId, userId), ne(sessions.id, sessionId), isNull(sessions.revokedAt)),
      );
    await recordAudit(tx, { entityType: 'user', entityId: userId, action: 'password_change' });
  });

  logger.info('Password changed, other sessions ended');
}

/**
 * Runs after the response is sent, so its timing cannot show whether the email has an account.
 * Only the newest link works, and each account gets at most three emails an hour.
 */
export async function requestPasswordReset(email: string) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();

  const userId = await db.transaction(async (tx) => {
    // Locked, so that parallel requests cannot pass the hourly limit.
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .for('update');

    if (!user) return undefined;

    await tx
      .delete(passwordResets)
      .where(
        and(
          eq(passwordResets.userId, user.id),
          lte(passwordResets.createdAt, new Date(now.getTime() - ONE_HOUR_MS)),
        ),
      );

    const [recent] = await tx
      .select({ total: count() })
      .from(passwordResets)
      .where(eq(passwordResets.userId, user.id));

    if (recent && recent.total >= MAX_RESET_EMAILS_PER_HOUR) {
      logger.warn('Password reset email limit reached');
      return undefined;
    }

    await tx
      .update(passwordResets)
      .set({ expiresAt: now })
      .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));

    await tx.insert(passwordResets).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
    });

    return user.id;
  });

  if (!userId) return;

  await sendEmail({
    to: email,
    subject: 'Reset your password',
    text: [
      'Someone asked to reset the password for your account. To choose a new password, open this link within 30 minutes:',
      '',
      `${env.PASSWORD_RESET_URL}#token=${token}`,
      '',
      'If this was not you, ignore this email. Your password has not changed.',
    ].join('\n'),
  });
}

/** Ends every session, as the old password may have been stolen. */
export async function resetPassword({ token, newPassword }: ResetPasswordBody) {
  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  await db.transaction(async (tx) => {
    const [reset] = await tx
      .update(passwordResets)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResets.tokenHash, hashToken(token)),
          isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, now),
        ),
      )
      .returning({ userId: passwordResets.userId });

    if (!reset) throw new AppError(400, 'This reset link is invalid or has expired');

    const [user] = await tx
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, reset.userId))
      .returning({ email: users.email });

    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, reset.userId), isNull(sessions.revokedAt)));

    await tx
      .update(passwordResets)
      .set({ expiresAt: now })
      .where(and(eq(passwordResets.userId, reset.userId), isNull(passwordResets.usedAt)));

    if (user) await tx.delete(loginAttempts).where(eq(loginAttempts.email, user.email));

    await recordAudit(tx, {
      entityType: 'user',
      entityId: reset.userId,
      action: 'password_reset',
    });
  });

  logger.info('Password reset, all sessions ended');
}

export async function getUser(userId: string) {
  const [user] = await db
    .select({
      ...publicUser,
      roleName: roles.name,
      roleId: users.roleId,
      granted: grantedPermissions,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, userId));

  if (!user) throw new AppError(401, 'Invalid or expired access token');

  const { roleId, roleName, granted, ...rest } = user;

  return {
    ...rest,
    role: roleId && roleName ? { id: roleId, name: roleName } : null,
    // Admin can hold every permission too, so this is what tells a super admin apart.
    superAdmin: roleId === SUPER_ADMIN_ROLE_ID,
    permissions: resolvePermissions(roleId, granted),
  };
}
