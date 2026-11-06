import { asc, eq, getTableColumns } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { FOREIGN_KEY_VIOLATION, hasDbErrorCode, UNIQUE_VIOLATION } from '../../lib/db-errors';
import { fileUrl } from '../../lib/storage';
import { assets } from '../assets/asset.schema';
import { paymentMethods, type PaymentMethod } from './payment-method.schema';
import type { CreatePaymentMethodBody, UpdatePaymentMethodBody } from './payment-method.validation';

const methodFields = { ...getTableColumns(paymentMethods), qrPath: assets.path };

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
    const [method] = await db
      .insert(paymentMethods)
      .values(data)
      .returning({ id: paymentMethods.id });
    if (!method) throw new AppError(500, 'Failed to create payment method');

    return await getMethod(method.id);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updateMethod(id: string, data: UpdatePaymentMethodBody) {
  try {
    const [method] = await db
      .update(paymentMethods)
      .set(data)
      .where(eq(paymentMethods.id, id))
      .returning({ id: paymentMethods.id });
    if (!method) notFound(id);

    return await getMethod(id);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function deleteMethod(id: string): Promise<void> {
  try {
    const [method] = await db
      .delete(paymentMethods)
      .where(eq(paymentMethods.id, id))
      .returning({ id: paymentMethods.id });

    if (!method) notFound(id);
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
