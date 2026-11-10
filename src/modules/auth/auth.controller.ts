import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';
import { AppError } from '../../lib/app-error';
import { toSafeLog } from '../../lib/db-errors';
import { logger } from '../../lib/logger';
import * as authService from './auth.service';
import type {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginBody,
  RefreshBody,
  RegisterBody,
  ResetPasswordBody,
} from './auth.validation';

const REFRESH_COOKIE = 'refreshToken';

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/auth',
};

function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...refreshCookieOptions,
    maxAge: authService.REFRESH_TOKEN_TTL_MS,
  });
}

export async function register(req: Request<object, object, RegisterBody>, res: Response) {
  res.status(201).json({ data: await authService.register(req.body) });
}

export async function login(req: Request<object, object, LoginBody>, res: Response) {
  const { user, accessToken, refreshToken } = await authService.login(req.body);

  res.set('Cache-Control', 'no-store');

  if (req.body.client === 'web') {
    setRefreshCookie(res, refreshToken);
    res.json({ data: { user, accessToken } });
    return;
  }

  res.json({ data: { user, accessToken, refreshToken } });
}

export async function refresh(req: Request<object, object, RefreshBody>, res: Response) {
  const bodyToken = req.body.refreshToken;
  const cookieToken: string | undefined = req.cookies[REFRESH_COOKIE];
  const currentToken = bodyToken ?? cookieToken;

  if (!currentToken) throw new AppError(401, 'Invalid or expired refresh token');

  const { accessToken, refreshToken } = await authService.refresh(currentToken);

  res.set('Cache-Control', 'no-store');

  if (bodyToken) {
    res.json({ data: { accessToken, refreshToken } });
    return;
  }

  setRefreshCookie(res, refreshToken);
  res.json({ data: { accessToken } });
}

export async function logout(_req: Request, res: Response) {
  await authService.logout(res.locals.auth.sessionId);
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
  res.status(204).send();
}

export async function logoutAll(_req: Request, res: Response) {
  await authService.logoutAll(res.locals.auth.userId);
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
  res.status(204).send();
}

export async function changePassword(
  req: Request<object, object, ChangePasswordBody>,
  res: Response,
) {
  const { userId, sessionId } = res.locals.auth;
  await authService.changePassword(userId, sessionId, req.body);
  res.status(204).send();
}

/** Always 202, and the email is sent afterwards, so the response never shows who has an account. */
export function forgotPassword(req: Request<object, object, ForgotPasswordBody>, res: Response) {
  res.status(202).send();

  authService.requestPasswordReset(req.body.email).catch((error: unknown) => {
    // Mail server errors can repeat the recipient, so only database details are kept.
    const err = toSafeLog(error);
    logger.error({ err: err instanceof Error ? err.name : err }, 'Password reset request failed');
  });
}

export async function resetPassword(
  req: Request<object, object, ResetPasswordBody>,
  res: Response,
) {
  await authService.resetPassword(req.body);
  res.status(204).send();
}

export async function me(_req: Request, res: Response) {
  res.json({ data: await authService.getUser(res.locals.auth.userId) });
}
