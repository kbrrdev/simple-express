import { eq } from 'drizzle-orm';
import { recordAudit } from '../modules/audit-logs/audit-log.service';
import { db, pool } from './index';
import { users } from './schema';

async function main() {
  const email = process.argv[2]?.toLowerCase();

  if (!email) throw new Error('Usage: npm run db:make-admin -- <email>');

  const user = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.email, email))
      .for('update');

    if (!user) throw new Error(`No user found with email ${email}`);

    // Every role change goes into the audit log, so that any future admin levels are covered too.
    if (user.role !== 'admin') {
      await tx.update(users).set({ role: 'admin' }).where(eq(users.id, user.id));
      await recordAudit(tx, {
        entityType: 'user',
        entityId: user.id,
        action: 'role_change',
        changes: { role: [user.role, 'admin'] },
      });
    }

    return user;
  });

  console.log(`${user.email} is now an admin`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
