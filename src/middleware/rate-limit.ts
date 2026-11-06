import type { Options } from 'express-rate-limit';
import { logger } from '../lib/logger';

export const logRateLimit: Options['handler'] = (req, res, _next, options) => {
  logger.warn({ method: req.method, route: req.route?.path }, 'Rate limit exceeded');
  res.status(options.statusCode).json(options.message);
};
