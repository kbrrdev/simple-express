import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import * as schema from './schema';

export const pool = new Pool({ connectionString: env.DATABASE_URL });

// Idle connections can drop at any time. Without this listener the process would crash.
pool.on('error', (error) => {
  logger.error({ reason: error.message }, 'Idle database connection error');
});

export const db = drizzle(pool, { schema });
