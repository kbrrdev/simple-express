import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { escapeIdentifier, escapeLiteral, Pool } from 'pg';
import { env } from '../config/env';
import { toSafeLog } from '../lib/db-errors';
import { logger } from '../lib/logger';

const pool = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

/** Creates the role in DATABASE_URL, which can read and write rows but not change the schema. */
async function grantAppRole(migrationUrl: string) {
  const app = new URL(env.DATABASE_URL);
  const role = decodeURIComponent(app.username);

  if (role === decodeURIComponent(new URL(migrationUrl).username)) return;

  const { rowCount } = await pool.query('select 1 from pg_roles where rolname = $1', [role]);
  const password = escapeLiteral(decodeURIComponent(app.password));

  await pool.query(
    `${rowCount ? 'ALTER' : 'CREATE'} ROLE ${escapeIdentifier(role)} LOGIN PASSWORD ${password}`,
  );
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${escapeIdentifier(role)}`,
  );
}

async function main() {
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });

  if (env.MIGRATION_DATABASE_URL) await grantAppRole(env.MIGRATION_DATABASE_URL);

  logger.info('Migrations applied');
}

main()
  .catch((error: unknown) => {
    logger.error({ err: toSafeLog(error) }, 'Migration failed');
    process.exitCode = 1;
  })
  .finally(() => pool.end());
