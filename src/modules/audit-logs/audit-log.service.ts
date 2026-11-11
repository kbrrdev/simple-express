import { and, count, desc, eq, getTableColumns, gte, lt } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { logContext } from '../../lib/request-context';
import { users } from '../auth/auth.schema';
import { startOfStoreDay } from '../reports/report.service';
import { auditLogs, type AuditChanges, type AuditEntityType } from './audit-log.schema';
import type { ListAuditLogsQuery } from './audit-log.validation';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Only shown as changed, so that account details and hashes never reach the history.
const REDACTED_FIELDS = new Set(['accountNumber', 'passwordHash']);

export interface AuditEntry {
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  changes?: AuditChanges;
}

/**
 * The fields in `fields` whose values differ, as `[before, after]`.
 * Pass `{}` as `before` for a new row, or as `after` for a deleted one.
 */
export function changesBetween(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): AuditChanges {
  const changes: AuditChanges = {};

  for (const field of fields) {
    const from = before[field] ?? null;
    const to = after[field] ?? null;

    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = [from, to];
  }

  return changes;
}

function redact(changes: AuditChanges): AuditChanges {
  const hide = (value: unknown) => (value === null ? null : '[redacted]');

  return Object.fromEntries(
    Object.entries(changes).map(([field, [from, to]]) =>
      REDACTED_FIELDS.has(field) ? [field, [hide(from), hide(to)]] : [field, [from, to]],
    ),
  );
}

/**
 * Run inside the transaction that makes the change, so the entry is only kept if the change is.
 * The actor is the signed-in user of the current request, and none for scripts and timers.
 */
export async function recordAudit(tx: Transaction, ...entries: AuditEntry[]) {
  const { requestId, userId } = logContext();

  await tx.insert(auditLogs).values(
    entries.map(({ changes = {}, ...entry }) => ({
      ...entry,
      changes: redact(changes),
      actorUserId: userId ?? null,
      requestId: requestId ?? null,
    })),
  );
}

export async function listAuditLogs({ page, limit, from, to, ...filters }: ListAuditLogsQuery) {
  if (from && to && from > to) throw new AppError(400, '`from` must be on or before `to`');

  const where = and(
    filters.actorUserId ? eq(auditLogs.actorUserId, filters.actorUserId) : undefined,
    filters.entityType ? eq(auditLogs.entityType, filters.entityType) : undefined,
    filters.entityId ? eq(auditLogs.entityId, filters.entityId) : undefined,
    filters.action ? eq(auditLogs.action, filters.action) : undefined,
    from ? gte(auditLogs.createdAt, startOfStoreDay(from)) : undefined,
    to ? lt(auditLogs.createdAt, startOfStoreDay(to, 1)) : undefined,
  );

  const [items, totals] = await Promise.all([
    db
      .select({ ...getTableColumns(auditLogs), actorEmail: users.email })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(where)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(auditLogs).where(where),
  ]);

  return { items, total: totals[0]?.total ?? 0 };
}
