import type { RequestHandler } from 'express';
import { AppError } from '../lib/app-error';
import { verifyAccessToken } from '../modules/auth/auth.service';

export const requireAuth: RequestHandler = async (req, res, next) => {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];

  if (scheme !== 'Bearer' || !token) {
    throw new AppError(401, 'Missing access token');
  }

  res.locals.auth = await verifyAccessToken(token);
  next();
};

/** Use after requireAuth. */
export const requireAdmin: RequestHandler = (_req, res, next) => {
  if (res.locals.auth.role !== 'admin') {
    throw new AppError(403, 'Admin access required');
  }

  next();
};
