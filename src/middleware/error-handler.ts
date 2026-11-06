import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../lib/app-error';
import { toSafeLog } from '../lib/db-errors';
import { logger } from '../lib/logger';
import { logContext, recentSteps } from '../lib/request-context';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, `Route not found: ${req.method} ${req.path}`));
};

/** Errors raised by Express middleware, such as malformed JSON or an oversized body. */
const isClientHttpError = (error: unknown): error is { status: number; message: string } => {
  const { status, expose } = error as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
};

/** What the request had finished before it failed. */
function progress() {
  const steps = [...recentSteps()];
  return { lastStep: steps.at(-1), steps };
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof AppError) {
    // Details are left out, as validation errors can repeat what a customer typed.
    const level = error.status >= 500 ? 'error' : 'warn';
    logger[level]({ status: error.status, ...progress() }, error.message);
    res.status(error.status).json({ error: { message: error.message, details: error.details } });
    return;
  }

  if (isClientHttpError(error)) {
    logger.warn({ status: error.status, ...progress() }, error.message);
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }

  logger.error({ err: toSafeLog(error), ...progress() }, 'Unexpected error');

  // Lets a customer quote this, so that support can find the exact failure.
  res.status(500).json({
    error: { message: 'Internal server error', requestId: logContext().requestId },
  });
};
