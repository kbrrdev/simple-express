import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

export const pool = new Pool({ connectionString: env.DATABASE_URL });

// Idle connections can drop at any time. Without this listener the process would crash.
pool.on('error', (error) => {
  console.error('Idle database connection error', error.message);
});

export const db = drizzle(pool, { schema });
