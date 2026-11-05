import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../lib/app-error';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, `Route not found: ${req.method} ${req.path}`));
};

/** Errors raised by Express middleware, such as malformed JSON or an oversized body. */
const isClientHttpError = (error: unknown): error is { status: number; message: string } => {
  const { status, expose } = error as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.status).json({ error: { message: error.message, details: error.details } });
    return;
  }

  if (isClientHttpError(error)) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }

  console.error(error);
  res.status(500).json({ error: { message: 'Internal server error' } });
};
