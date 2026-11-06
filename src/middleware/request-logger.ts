import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';
import { logger } from '../lib/logger';
import { logContext, runWithContext } from '../lib/request-context';

/** Drops the query string, and masks guest links, as their token gives access to an order. */
function safePath(url: string) {
  const [path = ''] = url.split('?');
  return path.replace(/\/guest\/[^/]+/, '/guest/[hidden]');
}

/** Runs first, so that everything after it is tracked by one request ID. */
export const requestLogger: RequestHandler = (req, res, next) => {
  runWithContext(() => {
    const startedAt = performance.now();

    res.setHeader('X-Request-Id', logContext().requestId ?? '');

    // Events lose the request's context, so the listener is bound to it.
    res.once(
      'close',
      AsyncLocalStorage.bind(() => {
        if (req.path === '/health') return;

        logger.info(
          {
            method: req.method,
            path: safePath(req.originalUrl),
            status: res.statusCode,
            durationMs: Math.round(performance.now() - startedAt),
          },
          'Request completed',
        );
      }),
    );

    next();
  });
};
