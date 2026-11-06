import { app } from './app';
import { env } from './config/env';
import { pool } from './db';
import { toSafeLog } from './lib/db-errors';
import { logger } from './lib/logger';
import { runWithContext } from './lib/request-context';
import { expireUnpaidOrders } from './modules/orders/order.service';

const EXPIRY_INTERVAL_MS = 5 * 60 * 1000;

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API listening');
});

const expiryTimer = setInterval(() => {
  runWithContext(() => {
    expireUnpaidOrders().catch((error: unknown) => {
      logger.error({ err: toSafeLog(error) }, 'Failed to expire unpaid orders');
    });
  });
}, EXPIRY_INTERVAL_MS);

function shutdown() {
  logger.info('Shutting down');
  clearInterval(expiryTimer);
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
