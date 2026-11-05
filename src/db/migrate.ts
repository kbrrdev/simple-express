import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index';

async function main() {
  await migrate(db, { migrationsFolder: 'drizzle' });
  console.log('Migrations applied');
}

main()
  .catch((error: unknown) => {
    console.error('Migration failed', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
