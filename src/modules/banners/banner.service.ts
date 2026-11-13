import { and, asc, count, eq, getTableColumns, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { FOREIGN_KEY_VIOLATION, hasDbErrorCode } from '../../lib/db-errors';
import { logger } from '../../lib/logger';
import { fileUrl } from '../../lib/storage';
import { assets } from '../assets/asset.schema';
import { changesBetween, recordAudit } from '../audit-logs/audit-log.service';
import { banners, type Banner } from './banner.schema';
import type { CreateBannerBody, UpdateBannerBody } from './banner.validation';

export const MAX_BANNERS = 15;

const mobileAssets = alias(assets, 'mobile_assets');
const bannerFields = {
  ...getTableColumns(banners),
  imagePath: assets.path,
  mobileImagePath: mobileAssets.path,
};
const BANNER_FIELDS = [
  'assetId',
  'mobileAssetId',
  'altText',
  'title',
  'subtitle',
  'linkUrl',
  'position',
  'isActive',
  'startsAt',
  'endsAt',
];

function toBanner({
  imagePath,
  mobileImagePath,
  ...banner
}: Banner & { imagePath: string; mobileImagePath: string | null }) {
  return {
    ...banner,
    imageUrl: fileUrl(imagePath),
    mobileImageUrl: mobileImagePath ? fileUrl(mobileImagePath) : null,
  };
}

function selectBanners() {
  return db
    .select(bannerFields)
    .from(banners)
    .innerJoin(assets, eq(banners.assetId, assets.id))
    .leftJoin(mobileAssets, eq(banners.mobileAssetId, mobileAssets.id))
    .$dynamic();
}

/** Active banners within their dates, which is what the storefront shows. */
export async function listCurrentBanners() {
  const now = new Date();
  const rows = await selectBanners()
    .where(
      and(
        eq(banners.isActive, true),
        or(isNull(banners.startsAt), lte(banners.startsAt, now)),
        or(isNull(banners.endsAt), gt(banners.endsAt, now)),
      ),
    )
    .orderBy(asc(banners.position), asc(banners.createdAt), asc(banners.id));

  return rows.map(toBanner);
}

export async function listAllBanners() {
  const rows = await selectBanners().orderBy(
    asc(banners.position),
    asc(banners.createdAt),
    asc(banners.id),
  );

  return rows.map(toBanner);
}

async function getBanner(id: string) {
  const [banner] = await selectBanners().where(eq(banners.id, id));

  return banner ? toBanner(banner) : notFound(id);
}

export async function createBanner(data: CreateBannerBody) {
  checkDates(data.startsAt, data.endsAt);

  try {
    const id = await db.transaction(async (tx) => {
      // Creates run one at a time, so that parallel requests cannot pass the limit.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('banners'))`);

      const [totals] = await tx.select({ total: count() }).from(banners);
      if ((totals?.total ?? 0) >= MAX_BANNERS) {
        throw new AppError(
          409,
          `A store can have at most ${MAX_BANNERS} banners. Delete one to add another.`,
        );
      }

      const [banner] = await tx.insert(banners).values(data).returning();
      if (!banner) throw new AppError(500, 'Failed to create banner');

      await recordAudit(tx, {
        entityType: 'banner',
        entityId: banner.id,
        action: 'create',
        changes: changesBetween({}, banner, BANNER_FIELDS),
      });

      return banner.id;
    });

    logger.info({ bannerId: id }, 'Banner added');

    return await getBanner(id);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updateBanner(id: string, data: UpdateBannerBody) {
  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(banners).where(eq(banners.id, id)).for('update');
      if (!existing) notFound(id);

      checkDates(
        data.startsAt === undefined ? existing.startsAt : data.startsAt,
        data.endsAt === undefined ? existing.endsAt : data.endsAt,
      );

      const [banner] = await tx.update(banners).set(data).where(eq(banners.id, id)).returning();
      if (!banner) notFound(id);

      await recordAudit(tx, {
        entityType: 'banner',
        entityId: id,
        action: 'update',
        changes: changesBetween(existing, banner, Object.keys(data)),
      });
    });

    logger.info({ bannerId: id, fields: Object.keys(data) }, 'Banner changed');

    return await getBanner(id);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function deleteBanner(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [banner] = await tx.delete(banners).where(eq(banners.id, id)).returning();
    if (!banner) notFound(id);

    await recordAudit(tx, {
      entityType: 'banner',
      entityId: id,
      action: 'delete',
      changes: changesBetween(banner, {}, BANNER_FIELDS),
    });
  });

  logger.info({ bannerId: id }, 'Banner deleted');
}

function checkDates(startsAt?: Date | null, endsAt?: Date | null) {
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new AppError(400, 'endsAt must be after startsAt');
  }
}

function toAppError(error: unknown) {
  if (hasDbErrorCode(error, FOREIGN_KEY_VIOLATION)) {
    return new AppError(400, 'Asset does not exist');
  }

  return error;
}

function notFound(id: string): never {
  throw new AppError(404, `Banner not found: ${id}`);
}
