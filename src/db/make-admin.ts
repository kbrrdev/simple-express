import { eq } from 'drizzle-orm';
import { db, pool } from './index';
import { users } from './schema';

async function main() {
  const email = process.argv[2]?.toLowerCase();

  if (!email) throw new Error('Usage: npm run db:make-admin -- <email>');

  const [user] = await db
    .update(users)
    .set({ role: 'admin' })
    .where(eq(users.email, email))
    .returning({ email: users.email });

  if (!user) throw new Error(`No user found with email ${email}`);

  console.log(`${user.email} is now an admin`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
