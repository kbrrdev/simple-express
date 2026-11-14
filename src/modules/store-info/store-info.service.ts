import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { changesBetween, recordAudit } from '../audit-logs/audit-log.service';
import { STORE_INFO_ID, storeInfo, type StoreInfo } from './store-info.schema';
import type { StoreInfoBody } from './store-info.validation';

// The ID is fixed, so it is left out of responses.
function toPublicStoreInfo({ id: _id, ...info }: StoreInfo) {
  return info;
}

export async function getStoreInfo() {
  const [info] = await db.select().from(storeInfo);
  // The migration creates the row, so it is only missing if someone deleted it.
  if (!info) throw new AppError(500, 'Store info is missing');
  return toPublicStoreInfo(info);
}

export async function updateStoreInfo(data: StoreInfoBody) {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(storeInfo)
      .where(eq(storeInfo.id, STORE_INFO_ID))
      .for('update');
    if (!existing) throw new AppError(500, 'Store info is missing');

    const [updated] = await tx
      .update(storeInfo)
      .set(data)
      .where(eq(storeInfo.id, STORE_INFO_ID))
      .returning();
    if (!updated) throw new AppError(500, 'Store info is missing');

    const changes = changesBetween(existing, updated, Object.keys(data));
    if (Object.keys(changes).length === 0) return;

    await recordAudit(tx, {
      entityType: 'store_info',
      entityId: STORE_INFO_ID,
      action: 'update',
      changes,
    });
  });

  return getStoreInfo();
}
