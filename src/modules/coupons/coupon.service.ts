import { and, count, desc, eq, inArray, sql, sum } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { FOREIGN_KEY_VIOLATION, hasDbErrorCode, UNIQUE_VIOLATION } from '../../lib/db-errors';
import { logger } from '../../lib/logger';
import { changesBetween, recordAudit } from '../audit-logs/audit-log.service';
import { couponRedemptions, coupons, type Coupon } from './coupon.schema';
import type { CreateCouponBody, UpdateCouponBody } from './coupon.validation';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Database = typeof db | Transaction;

const COUPON_FIELDS = [
  'code',
  'discountType',
  'discountValue',
  'maxDiscountCents',
  'minSubtotalCents',
  'startsAt',
  'endsAt',
  'usageLimit',
  'perCustomerLimit',
  'allowSaleItems',
  'allowGuests',
  'isActive',
];

/** Who is using the coupon. Null when a preview does not say, which skips per-customer limits. */
export type CouponCustomer = { userId: string } | { guestEmail: string } | null;

export interface CouponLine {
  variantId: string;
  lineTotalCents: number;
  onSale: boolean;
}

export interface AppliedCoupon {
  coupon: Coupon;
  /** The coupon's share of each eligible line, by variant. */
  lineDiscounts: Map<string, number>;
  discountCents: number;
  freeShipping: boolean;
}

const peso = (cents: number) =>
  (cents / 100).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' });

/**
 * Checks a coupon against the cart and works out its discount, or returns why it cannot be used.
 * Checkout locks the coupon row, so that parallel orders cannot pass its limits.
 */
export async function applyCoupon(
  database: Database,
  code: string,
  customer: CouponCustomer,
  lines: CouponLine[],
  lock = false,
): Promise<AppliedCoupon | { error: string }> {
  const query = database.select().from(coupons).where(eq(coupons.code, code.toUpperCase()));
  const [coupon] = lock ? await query.for('update') : await query;
  const now = new Date();

  if (!coupon || !coupon.isActive) return { error: 'This coupon is not valid' };
  if (coupon.startsAt && coupon.startsAt > now) return { error: 'This coupon is not active yet' };
  if (coupon.endsAt && coupon.endsAt <= now) return { error: 'This coupon has expired' };

  const isGuest = customer === null || 'guestEmail' in customer;
  if (isGuest && !coupon.allowGuests) return { error: 'Log in to use this coupon' };

  if (coupon.usageLimit !== null) {
    const [used] = await database
      .select({ total: count() })
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, coupon.id));
    if ((used?.total ?? 0) >= coupon.usageLimit) {
      return { error: 'This coupon has been fully used' };
    }
  }

  if (coupon.perCustomerLimit !== null && customer !== null) {
    const [used] = await database
      .select({ total: count() })
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.couponId, coupon.id),
          'userId' in customer
            ? eq(couponRedemptions.userId, customer.userId)
            : sql`lower(${couponRedemptions.guestEmail}) = lower(${customer.guestEmail})`,
        ),
      );
    if ((used?.total ?? 0) >= coupon.perCustomerLimit) {
      return { error: 'You have already used this coupon' };
    }
  }

  const eligible = lines.filter((line) => coupon.allowSaleItems || !line.onSale);
  const eligibleCents = eligible.reduce((total, line) => total + line.lineTotalCents, 0);

  if (eligible.length === 0) return { error: 'This coupon cannot be used on items on sale' };

  if (coupon.minSubtotalCents !== null && eligibleCents < coupon.minSubtotalCents) {
    const more = peso(coupon.minSubtotalCents - eligibleCents);
    return { error: `Spend ${more} more on eligible items to use this coupon` };
  }

  const value = coupon.discountValue ?? 0;
  let discountCents = 0;

  if (coupon.discountType === 'percent') {
    discountCents = Math.round((eligibleCents * value) / 100);
    if (coupon.maxDiscountCents !== null) {
      discountCents = Math.min(discountCents, coupon.maxDiscountCents);
    }
  } else if (coupon.discountType === 'fixed') {
    discountCents = Math.min(value, eligibleCents);
  }

  return {
    coupon,
    lineDiscounts: spread(discountCents, eligible),
    discountCents,
    freeShipping: coupon.discountType === 'free_shipping',
  };
}

/**
 * Splits a discount across lines in proportion to their totals, so that each line's tax and any
 * refund stay right. Rounding leftovers go to the largest lines, never past a line's total.
 */
export function spread(discountCents: number, lines: CouponLine[]) {
  const total = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const shares = new Map(
    lines.map((line) => [
      line.variantId,
      total > 0 ? Math.floor((discountCents * line.lineTotalCents) / total) : 0,
    ]),
  );

  let left = discountCents - [...shares.values()].reduce((sum, share) => sum + share, 0);
  const largestFirst = [...lines].sort((a, b) => b.lineTotalCents - a.lineTotalCents);

  for (const line of largestFirst) {
    if (left <= 0) break;
    const share = shares.get(line.variantId) ?? 0;
    const extra = Math.min(left, line.lineTotalCents - share);
    shares.set(line.variantId, share + extra);
    left -= extra;
  }

  return shares;
}

export async function recordRedemption(
  tx: Transaction,
  values: {
    orderId: string;
    couponId: string;
    userId?: string;
    guestEmail?: string;
    discountCents: number;
  },
) {
  await tx.insert(couponRedemptions).values(values);
}

/** Gives the use back when an order is cancelled. */
export async function releaseRedemption(tx: Transaction, orderId: string) {
  await tx.delete(couponRedemptions).where(eq(couponRedemptions.orderId, orderId));
}

async function withUsage(database: Database, rows: Coupon[]) {
  const usage =
    rows.length === 0
      ? []
      : await database
          .select({
            couponId: couponRedemptions.couponId,
            usedCount: count(),
            discountGivenCents: sum(couponRedemptions.discountCents).mapWith(Number),
          })
          .from(couponRedemptions)
          .where(
            inArray(
              couponRedemptions.couponId,
              rows.map((row) => row.id),
            ),
          )
          .groupBy(couponRedemptions.couponId);

  return rows.map((coupon) => {
    const used = usage.find((row) => row.couponId === coupon.id);
    return {
      ...coupon,
      usedCount: used?.usedCount ?? 0,
      discountGivenCents: used?.discountGivenCents ?? 0,
    };
  });
}

export async function listCoupons() {
  const rows = await db.select().from(coupons).orderBy(desc(coupons.createdAt), desc(coupons.id));

  return withUsage(db, rows);
}

export async function getCoupon(id: string) {
  const [coupon] = await db.select().from(coupons).where(eq(coupons.id, id));
  if (!coupon) notFound(id);

  const [withCounts] = await withUsage(db, [coupon]);
  return withCounts ?? notFound(id);
}

export async function createCoupon(data: CreateCouponBody) {
  const values = checkCoupon(data);

  try {
    const id = await db.transaction(async (tx) => {
      const [coupon] = await tx.insert(coupons).values(values).returning();
      if (!coupon) throw new AppError(500, 'Failed to create coupon');

      await recordAudit(tx, {
        entityType: 'coupon',
        entityId: coupon.id,
        action: 'create',
        changes: changesBetween({}, coupon, COUPON_FIELDS),
      });

      return coupon.id;
    });

    logger.info({ couponId: id }, 'Coupon added');

    return await getCoupon(id);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updateCoupon(id: string, data: UpdateCouponBody) {
  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(coupons).where(eq(coupons.id, id)).for('update');
      if (!existing) notFound(id);

      const values = checkCoupon({ ...existing, ...data });
      const [coupon] = await tx
        .update(coupons)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(coupons.id, id))
        .returning();
      if (!coupon) notFound(id);

      await recordAudit(tx, {
        entityType: 'coupon',
        entityId: id,
        action: 'update',
        changes: changesBetween(existing, coupon, COUPON_FIELDS),
      });
    });

    logger.info({ couponId: id, fields: Object.keys(data) }, 'Coupon changed');

    return await getCoupon(id);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function deleteCoupon(id: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [coupon] = await tx.delete(coupons).where(eq(coupons.id, id)).returning();
      if (!coupon) notFound(id);

      await recordAudit(tx, {
        entityType: 'coupon',
        entityId: id,
        action: 'delete',
        changes: changesBetween(coupon, {}, COUPON_FIELDS),
      });
    });

    logger.info({ couponId: id }, 'Coupon deleted');
  } catch (error) {
    if (hasDbErrorCode(error, FOREIGN_KEY_VIOLATION)) {
      throw new AppError(409, 'Orders use this coupon, so turn it off instead');
    }
    throw error;
  }
}

/** Checks the coupon as a whole, after an update is merged into what was saved. */
function checkCoupon<T extends CreateCouponBody>(coupon: T) {
  const value = coupon.discountValue ?? null;

  if (coupon.discountType === 'percent' && (value === null || value > 100)) {
    throw new AppError(400, 'A percentage coupon needs a discountValue from 1 to 100');
  }

  if (coupon.discountType === 'fixed' && value === null) {
    throw new AppError(400, 'A fixed coupon needs a discountValue in cents');
  }

  if (coupon.startsAt && coupon.endsAt && coupon.endsAt <= coupon.startsAt) {
    throw new AppError(400, 'endsAt must be after startsAt');
  }

  // Free shipping has no amount, and only percentages need a cap.
  return {
    ...coupon,
    discountValue: coupon.discountType === 'free_shipping' ? null : value,
    maxDiscountCents: coupon.discountType === 'percent' ? (coupon.maxDiscountCents ?? null) : null,
  };
}

function toAppError(error: unknown) {
  if (hasDbErrorCode(error, UNIQUE_VIOLATION)) {
    return new AppError(409, 'A coupon with this code already exists');
  }

  return error;
}

function notFound(id: string): never {
  throw new AppError(404, `Coupon not found: ${id}`);
}
