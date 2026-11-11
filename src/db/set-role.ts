import { eq, sql } from 'drizzle-orm';
import { assignRole } from '../modules/users/user.service';
import { lockRoles } from '../modules/roles/role.service';
import { db, pool } from './index';
import { roles, users } from './schema';

const CUSTOMER = 'customer';

async function main() {
  const email = process.argv[2]?.toLowerCase();
  const roleName = process.argv[3]?.trim();

  if (!email || !roleName) {
    throw new Error(`Usage: npm run db:set-role -- <email> <role name, or ${CUSTOMER}>`);
  }

  await db.transaction(async (tx) => {
    await lockRoles(tx);

    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (!user) throw new Error(`No user found with email ${email}`);

    let roleId: string | null = null;

    if (roleName.toLowerCase() !== CUSTOMER) {
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(sql`lower(${roles.name})`, roleName.toLowerCase()));
      if (!role) throw new Error(`No role found named ${roleName}`);
      roleId = role.id;
    }

    // Recorded in the audit log with no actor, as it was run from the command line.
    await assignRole(tx, user.id, roleId);
  });

  console.log(`${email} now has the role ${roleName}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
