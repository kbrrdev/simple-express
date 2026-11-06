import { app } from './app';
import { env } from './config/env';
import { pool } from './db';
import { toSafeLog } from './lib/db-errors';
import { expireUnpaidOrders } from './modules/orders/order.service';

const EXPIRY_INTERVAL_MS = 5 * 60 * 1000;

const server = app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

const expiryTimer = setInterval(() => {
  expireUnpaidOrders().catch((error: unknown) => {
    console.error('Failed to expire unpaid orders', toSafeLog(error));
  });
}, EXPIRY_INTERVAL_MS);

function shutdown() {
  clearInterval(expiryTimer);
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
