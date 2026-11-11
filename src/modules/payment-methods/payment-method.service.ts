import { asc, eq, getTableColumns } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { FOREIGN_KEY_VIOLATION, hasDbErrorCode, UNIQUE_VIOLATION } from '../../lib/db-errors';
import { logger } from '../../lib/logger';
import { fileUrl } from '../../lib/storage';
import { assets } from '../assets/asset.schema';
import { changesBetween, recordAudit } from '../audit-logs/audit-log.service';
import { paymentMethods, type PaymentMethod } from './payment-method.schema';
import type { CreatePaymentMethodBody, UpdatePaymentMethodBody } from './payment-method.validation';

const methodFields = { ...getTableColumns(paymentMethods), qrPath: assets.path };
const METHOD_FIELDS = [
  'type',
  'providerName',
  'accountName',
  'accountNumber',
  'qrAssetId',
  'enabled',
];

function toAdminMethod({ qrPath, ...method }: PaymentMethod & { qrPath: string | null }) {
  return { ...method, qrUrl: qrPath ? fileUrl(qrPath) : null };
}

/** What a customer chooses from. Account details are only shown once they place an order. */
export function listEnabledMethods() {
  return db
    .select({
      id: paymentMethods.id,
      type: paymentMethods.type,
      providerName: paymentMethods.providerName,
    })
    .from(paymentMethods)
    .where(eq(paymentMethods.enabled, true))
    .orderBy(asc(paymentMethods.providerName), asc(paymentMethods.id));
}

export async function listAllMethods() {
  const rows = await db
    .select(methodFields)
    .from(paymentMethods)
    .leftJoin(assets, eq(paymentMethods.qrAssetId, assets.id))
    .orderBy(asc(paymentMethods.providerName), asc(paymentMethods.id));

  return rows.map(toAdminMethod);
}

async function getMethod(id: string) {
  const [method] = await db
    .select(methodFields)
    .from(paymentMethods)
    .leftJoin(assets, eq(paymentMethods.qrAssetId, assets.id))
    .where(eq(paymentMethods.id, id));

  return method ? toAdminMethod(method) : notFound(id);
}

export async function createMethod(data: CreatePaymentMethodBody) {
  try {
    const id = await db.transaction(async (tx) => {
      const [method] = await tx.insert(paymentMethods).values(data).returning();
      if (!method) throw new AppError(500, 'Failed to create payment method');

      await recordAudit(tx, {
        entityType: 'payment_method',
        entityId: method.id,
        action: 'create',
        changes: changesBetween({}, method, METHOD_FIELDS),
      });

      return method.id;
    });

    logger.info({ paymentMethodId: id }, 'Payment method added');

    return await getMethod(id);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updateMethod(id: string, data: UpdatePaymentMethodBody) {
  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(paymentMethods)
        .where(eq(paymentMethods.id, id))
        .for('update');
      if (!existing) notFound(id);

      const [method] = await tx
        .update(paymentMethods)
        .set(data)
        .where(eq(paymentMethods.id, id))
        .returning();
      if (!method) notFound(id);

      await recordAudit(tx, {
        entityType: 'payment_method',
        entityId: id,
        action: 'update',
        changes: changesBetween(existing, method, Object.keys(data)),
      });
    });

    // Field names only, so that account details stay out of the logs.
    logger.info({ paymentMethodId: id, fields: Object.keys(data) }, 'Payment method changed');

    return await getMethod(id);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function deleteMethod(id: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [method] = await tx.delete(paymentMethods).where(eq(paymentMethods.id, id)).returning();
      if (!method) notFound(id);

      await recordAudit(tx, {
        entityType: 'payment_method',
        entityId: id,
        action: 'delete',
        changes: changesBetween(method, {}, METHOD_FIELDS),
      });
    });

    logger.info({ paymentMethodId: id }, 'Payment method deleted');
  } catch (error) {
    if (hasDbErrorCode(error, FOREIGN_KEY_VIOLATION)) {
      throw new AppError(409, 'Orders use this payment method, so turn it off instead');
    }
    throw error;
  }
}

function toAppError(error: unknown) {
  if (hasDbErrorCode(error, UNIQUE_VIOLATION)) {
    return new AppError(409, 'This account already exists for this provider');
  }

  if (hasDbErrorCode(error, FOREIGN_KEY_VIOLATION)) {
    return new AppError(400, 'Asset does not exist');
  }

  return error;
}

function notFound(id: string): never {
  throw new AppError(404, `Payment method not found: ${id}`);
}
