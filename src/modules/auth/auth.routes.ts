import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { logRateLimit } from '../../middleware/rate-limit';
import { requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './auth.controller';
import { changePasswordBody, loginBody, refreshBody, registerBody } from './auth.validation';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const tooManyRequests = { error: { message: 'Too many requests, try again later' } };

export const credentialsLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooManyRequests,
  handler: logRateLimit,
});

export const refreshLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooManyRequests,
  handler: logRateLimit,
});

export const authRoutes = Router();

authRoutes.post(
  '/register',
  credentialsLimiter,
  validate('body', registerBody),
  controller.register,
);
authRoutes.post('/login', credentialsLimiter, validate('body', loginBody), controller.login);
authRoutes.post('/refresh', refreshLimiter, validate('body', refreshBody), controller.refresh);
authRoutes.post(
  '/change-password',
  credentialsLimiter,
  requireAuth,
  validate('body', changePasswordBody),
  controller.changePassword,
);
authRoutes.post('/logout', requireAuth, controller.logout);
authRoutes.post('/logout-all', requireAuth, controller.logoutAll);
authRoutes.get('/me', requireAuth, controller.me);
