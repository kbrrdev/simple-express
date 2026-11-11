import { and, count, desc, eq, ilike, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { escapeLikePattern } from '../../lib/escape-like-pattern';
import { recordAudit } from '../audit-logs/audit-log.service';
import { users } from '../auth/auth.schema';
import { getUser } from '../auth/auth.service';
import { roles, SUPER_ADMIN_ROLE_ID } from '../roles/role.schema';
import { lockRoles } from '../roles/role.service';
import type { ListUsersQuery } from './user.validation';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Lists CMS users with `type=staff`, or finds a customer to promote with `type=customer`.
 * Searches part of the email, ignoring case. Customers are not indexed for this, as only
 * super admins search them, and only now and then.
 */
export async function listUsers({ page, limit, search, type, roleId }: ListUsersQuery) {
  const where = and(
    search ? ilike(users.email, `%${escapeLikePattern(search)}%`) : undefined,
    type === 'staff' ? isNotNull(users.roleId) : undefined,
    type === 'customer' ? isNull(users.roleId) : undefined,
    roleId ? eq(users.roleId, roleId) : undefined,
  );

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        roleId: users.roleId,
        roleName: roles.name,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(where)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(users).where(where),
  ]);

  const items = rows.map(({ roleId: id, roleName, ...user }) => ({
    ...user,
    role: id && roleName ? { id, name: roleName } : null,
  }));

  return { items, total: totals[0]?.total ?? 0 };
}

/**
 * Super admins cannot change their own role. As the one making the change is a super admin
 * and is checked under the lock, the store always keeps at least one.
 */
export async function setUserRole(actorId: string, userId: string, roleId: string | null) {
  if (actorId === userId) throw new AppError(409, 'You cannot change your own role');

  await db.transaction(async (tx) => {
    await lockRoles(tx);

    // Another super admin may have removed this one while the request waited for the lock.
    const [actor] = await tx
      .select({ roleId: users.roleId })
      .from(users)
      .where(eq(users.id, actorId));
    if (actor?.roleId !== SUPER_ADMIN_ROLE_ID) {
      throw new AppError(403, 'Super admin access required');
    }

    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!user) throw new AppError(404, `User not found: ${userId}`);

    await assignRole(tx, userId, roleId);
  });

  return getUser(userId);
}

/** Expects the caller to hold `lockRoles`. Records the change by role name, as names can change later. */
export async function assignRole(tx: Transaction, userId: string, roleId: string | null) {
  const [current] = await tx
    .select({ roleId: users.roleId, roleName: roles.name })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, userId))
    .for('update', { of: users });

  if (!current) throw new AppError(404, `User not found: ${userId}`);
  if (current.roleId === roleId) return;

  let roleName: string | null = null;

  if (roleId) {
    const [role] = await tx.select({ name: roles.name }).from(roles).where(eq(roles.id, roleId));
    if (!role) throw new AppError(400, 'Role does not exist');
    roleName = role.name;
  }

  await tx.update(users).set({ roleId }).where(eq(users.id, userId));
  await recordAudit(tx, {
    entityType: 'user',
    entityId: userId,
    action: 'role_change',
    changes: { role: [current.roleName, roleName] },
  });
}
