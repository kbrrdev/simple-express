import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { FOREIGN_KEY_VIOLATION, hasDbErrorCode, UNIQUE_VIOLATION } from '../../lib/db-errors';
import { changesBetween, recordAudit } from '../audit-logs/audit-log.service';
import { users } from '../auth/auth.schema';
import { allPermissions, permissions, resolvePermissions, type Permission } from './permissions';
import { rolePermissions, roles, SUPER_ADMIN_ROLE_ID, type Role } from './role.schema';
import type { CreateRoleBody, UpdateRoleBody } from './role.validation';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ROLE_FIELDS = ['name', 'description', 'permissions'];

/**
 * Role changes and role assignments run one at a time, so that two super admins
 * cannot remove each other at the same moment and leave the store without one.
 */
export async function lockRoles(tx: Transaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('roles'))`);
}

export function listPermissions() {
  return allPermissions.map((key) => ({ key, description: permissions[key] }));
}

/** Adds each role's permissions and how many users have it. */
async function withDetails(rows: Role[]) {
  const ids = rows.map((role) => role.id);
  const [granted, counts] = await Promise.all([
    db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, ids)),
    db
      .select({ roleId: users.roleId, total: count() })
      .from(users)
      .where(inArray(users.roleId, ids))
      .groupBy(users.roleId),
  ]);

  return rows.map((role) => {
    const own = granted.filter((row) => row.roleId === role.id).map((row) => row.permission);

    return {
      ...role,
      builtIn: role.id === SUPER_ADMIN_ROLE_ID,
      permissions: resolvePermissions(role.id, own),
      userCount: counts.find((row) => row.roleId === role.id)?.total ?? 0,
    };
  });
}

export async function listRoles() {
  const rows = await db.select().from(roles).orderBy(asc(roles.name), asc(roles.id));
  return withDetails(rows);
}

export async function getRole(id: string) {
  const [role] = await withDetails(await db.select().from(roles).where(eq(roles.id, id)));
  return role ?? notFound(id);
}

export async function createRole({ permissions: granted, ...data }: CreateRoleBody) {
  try {
    const id = await db.transaction(async (tx) => {
      await lockRoles(tx);

      const [role] = await tx.insert(roles).values(data).returning();
      if (!role) throw new AppError(500, 'Failed to create role');

      await savePermissions(tx, role.id, granted);
      await recordAudit(tx, {
        entityType: 'role',
        entityId: role.id,
        action: 'create',
        changes: changesBetween({}, { ...role, permissions: sorted(granted) }, ROLE_FIELDS),
      });

      return role.id;
    });

    return await getRole(id);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updateRole(id: string, { permissions: granted, ...data }: UpdateRoleBody) {
  assertNotBuiltIn(id);

  try {
    await db.transaction(async (tx) => {
      await lockRoles(tx);

      const before = await findRole(tx, id);
      let after = before;

      if (Object.keys(data).length > 0) {
        const [role] = await tx.update(roles).set(data).where(eq(roles.id, id)).returning();
        if (!role) notFound(id);
        after = { ...role, permissions: before.permissions };
      }

      if (granted) {
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
        await savePermissions(tx, id, granted);
        after = { ...after, permissions: sorted(granted) };
      }

      await recordAudit(tx, {
        entityType: 'role',
        entityId: id,
        action: 'update',
        changes: changesBetween(before, after, ROLE_FIELDS),
      });
    });

    return await getRole(id);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function deleteRole(id: string): Promise<void> {
  assertNotBuiltIn(id);

  try {
    await db.transaction(async (tx) => {
      await lockRoles(tx);

      const before = await findRole(tx, id);

      await tx.delete(roles).where(eq(roles.id, id));
      await recordAudit(tx, {
        entityType: 'role',
        entityId: id,
        action: 'delete',
        changes: changesBetween(before, {}, ROLE_FIELDS),
      });
    });
  } catch (error) {
    if (hasDbErrorCode(error, FOREIGN_KEY_VIOLATION)) {
      throw new AppError(409, 'Users still have this role, so give them another role first');
    }
    throw error;
  }
}

async function findRole(tx: Transaction, id: string) {
  const [role] = await tx.select().from(roles).where(eq(roles.id, id)).for('update');
  if (!role) notFound(id);

  const rows = await tx
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, id));

  return { ...role, permissions: sorted(rows.map((row) => row.permission)) };
}

async function savePermissions(tx: Transaction, roleId: string, granted: Permission[]) {
  if (granted.length === 0) return;

  await tx.insert(rolePermissions).values(granted.map((permission) => ({ roleId, permission })));
}

/** Follows the order of the permission list, so audit entries only differ when access does. */
function sorted(granted: Permission[]) {
  return allPermissions.filter((permission) => granted.includes(permission));
}

function assertNotBuiltIn(id: string) {
  if (id === SUPER_ADMIN_ROLE_ID) {
    throw new AppError(409, 'The Super admin role cannot be changed or deleted');
  }
}

function toAppError(error: unknown) {
  return hasDbErrorCode(error, UNIQUE_VIOLATION)
    ? new AppError(409, 'A role with this name already exists')
    : error;
}

function notFound(id: string): never {
  throw new AppError(404, `Role not found: ${id}`);
}
