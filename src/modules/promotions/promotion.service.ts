import { and, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { FOREIGN_KEY_VIOLATION, hasDbErrorCode } from '../../lib/db-errors';
import { logger } from '../../lib/logger';
import { changesBetween, recordAudit } from '../audit-logs/audit-log.service';
import { spread } from '../coupons/coupon.service';
import { products } from '../products/product.schema';
import { categoryAncestors } from '../sales/sale.service';
import {
  promotionCategories,
  promotionProducts,
  promotions,
  type Promotion,
} from './promotion.schema';
import type { CreatePromotionBody, UpdatePromotionBody } from './promotion.validation';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Database = typeof db | Transaction;
type PromotionWithTargets = Promotion & { productIds: string[]; categoryIds: string[] };

const MAX_BUNDLE_PRODUCTS = 10;
const PROMOTION_FIELDS = [
  'name',
  'type',
  'buyQuantity',
  'getQuantity',
  'getPercentOff',
  'discountType',
  'discountValue',
  'startsAt',
  'endsAt',
  'isActive',
  'productIds',
  'categoryIds',
];

export interface PromotionLine {
  variantId: string;
  productId: string;
  unitPriceCents: number;
  quantity: number;
  onSale: boolean;
}

export interface PromotionResult {
  /** Each discounted line's share, and the promotion it came from. */
  lineDiscounts: Map<string, { discountCents: number; promotionName: string }>;
  applied: { id: string; name: string; discountCents: number }[];
}

interface Candidate {
  totalCents: number;
  shares: Map<string, number>;
  involved: Set<string>;
}

/**
 * Applies buy X get Y and bundle promotions to a cart. Items on sale are left out. Each line gets
 * at most one promotion: the largest discount goes first, and later ones skip the lines it used.
 */
export async function applyPromotions(
  database: Database,
  lines: PromotionLine[],
): Promise<PromotionResult> {
  const result: PromotionResult = { lineDiscounts: new Map(), applied: [] };
  const eligible = lines.filter((line) => !line.onSale);
  if (eligible.length === 0) return result;

  const current = await findCurrentPromotions(database);
  if (current.length === 0) return result;

  const covers = await coverage(
    database,
    current,
    eligible.map((line) => line.productId),
  );
  const used = new Set<string>();
  let remaining = current;

  for (;;) {
    const candidates = remaining
      .map((promotion) => ({
        promotion,
        ...discountFor(
          promotion,
          eligible.filter((line) => !used.has(line.variantId) && covers(promotion, line.productId)),
        ),
      }))
      .filter((candidate) => candidate.totalCents > 0);

    const best = candidates.reduce<(typeof candidates)[number] | undefined>(
      (top, candidate) => (!top || candidate.totalCents > top.totalCents ? candidate : top),
      undefined,
    );
    if (!best) return result;

    for (const [variantId, discountCents] of best.shares) {
      if (discountCents > 0) {
        result.lineDiscounts.set(variantId, { discountCents, promotionName: best.promotion.name });
      }
    }
    for (const variantId of best.involved) used.add(variantId);
    result.applied.push({
      id: best.promotion.id,
      name: best.promotion.name,
      discountCents: best.totalCents,
    });
    remaining = remaining.filter((promotion) => promotion !== best.promotion);
  }
}

function discountFor(promotion: Promotion & { productIds: string[] }, lines: PromotionLine[]) {
  return promotion.type === 'bundle'
    ? bundleDiscount(promotion, lines)
    : buyXGetYDiscount(promotion, lines);
}

/** The cheapest units in the cart are the ones discounted, as is usual in shops. */
function buyXGetYDiscount(promotion: Promotion, lines: PromotionLine[]): Candidate {
  const buy = promotion.buyQuantity ?? 0;
  const get = promotion.getQuantity ?? 0;
  const percentOff = promotion.getPercentOff ?? 0;
  const units = lines
    .flatMap((line) => Array.from({ length: line.quantity }, () => line))
    .sort((a, b) => b.unitPriceCents - a.unitPriceCents || a.variantId.localeCompare(b.variantId));

  const sets = Math.floor(units.length / (buy + get));
  const counted = units.slice(0, sets * buy);
  const discounted = sets > 0 ? units.slice(-sets * get) : [];
  const shares = new Map<string, number>();

  for (const unit of discounted) {
    const share = Math.round((unit.unitPriceCents * percentOff) / 100);
    shares.set(unit.variantId, (shares.get(unit.variantId) ?? 0) + share);
  }

  return {
    totalCents: [...shares.values()].reduce((total, share) => total + share, 0),
    shares,
    involved: new Set([...counted, ...discounted].map((unit) => unit.variantId)),
  };
}

/** Each complete set is priced with the cheapest unit of each product in the cart. */
function bundleDiscount(
  promotion: Promotion & { productIds: string[] },
  lines: PromotionLine[],
): Candidate {
  const none = { totalCents: 0, shares: new Map(), involved: new Set<string>() };
  const byProduct = promotion.productIds.map((productId) =>
    lines
      .filter((line) => line.productId === productId)
      .sort((a, b) => a.unitPriceCents - b.unitPriceCents),
  );
  if (byProduct.some((productLines) => productLines.length === 0)) return none;

  const quantityOf = (productLines: PromotionLine[]) =>
    productLines.reduce((total, line) => total + line.quantity, 0);
  const sets = Math.min(...byProduct.map(quantityOf));

  const setPriceCents = byProduct.reduce(
    (total, productLines) => total + (productLines[0]?.unitPriceCents ?? 0),
    0,
  );
  const perSetCents =
    promotion.discountType === 'percent'
      ? Math.round((setPriceCents * (promotion.discountValue ?? 0)) / 100)
      : Math.min(promotion.discountValue ?? 0, setPriceCents);

  // Takes `sets` units of each product, cheapest first, and splits the discount across them.
  const allocated = byProduct.flatMap((productLines) => {
    let left = sets;
    return productLines.flatMap((line) => {
      const units = Math.min(left, line.quantity);
      left -= units;
      return units > 0
        ? [
            {
              variantId: line.variantId,
              lineTotalCents: units * line.unitPriceCents,
              onSale: false,
            },
          ]
        : [];
    });
  });

  const totalCents = perSetCents * sets;

  return {
    totalCents,
    shares: spread(totalCents, allocated),
    involved: new Set(allocated.map((line) => line.variantId)),
  };
}

/** Active promotions within their dates, with what they cover. */
async function findCurrentPromotions(database: Database) {
  const now = new Date();
  const rows = await database
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.isActive, true),
        or(isNull(promotions.startsAt), lte(promotions.startsAt, now)),
        or(isNull(promotions.endsAt), gt(promotions.endsAt, now)),
      ),
    );

  return withTargets(database, rows);
}

/** Tells whether a promotion covers a product, by the product or its categories and parents. */
async function coverage(database: Database, current: PromotionWithTargets[], productIds: string[]) {
  const rows =
    productIds.length === 0
      ? []
      : await database
          .select({ id: products.id, categoryId: products.categoryId })
          .from(products)
          .where(inArray(products.id, productIds));
  const categoryOf = new Map(rows.map((row) => [row.id, row.categoryId]));
  const ancestorsOf = await categoryAncestors(
    database,
    current.some((promotion) => promotion.categoryIds.length > 0),
  );

  return (promotion: PromotionWithTargets, productId: string) => {
    if (promotion.productIds.includes(productId)) return true;
    const categoryId = categoryOf.get(productId);
    return categoryId !== undefined
      ? ancestorsOf(categoryId).some((id) => promotion.categoryIds.includes(id))
      : false;
  };
}

/** The promotions running on each product, for badges on product pages. */
export async function findProductPromotions(database: Database, productIds: string[]) {
  const badges = new Map<string, { id: string; name: string; type: Promotion['type'] }[]>();
  const current = await findCurrentPromotions(database);
  if (current.length === 0 || productIds.length === 0) return badges;

  const covers = await coverage(database, current, productIds);
  for (const productId of productIds) {
    badges.set(
      productId,
      current
        .filter((promotion) => covers(promotion, productId))
        .map(({ id, name, type }) => ({ id, name, type })),
    );
  }

  return badges;
}

async function withTargets(database: Database, rows: Promotion[]) {
  const ids = rows.map((row) => row.id);
  const [productRows, categoryRows] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          database
            .select()
            .from(promotionProducts)
            .where(inArray(promotionProducts.promotionId, ids)),
          database
            .select()
            .from(promotionCategories)
            .where(inArray(promotionCategories.promotionId, ids)),
        ]);

  return rows.map((promotion) => ({
    ...promotion,
    productIds: productRows
      .filter((row) => row.promotionId === promotion.id)
      .map((row) => row.productId),
    categoryIds: categoryRows
      .filter((row) => row.promotionId === promotion.id)
      .map((row) => row.categoryId),
  }));
}

export async function listPromotions() {
  const rows = await db
    .select()
    .from(promotions)
    .orderBy(desc(promotions.createdAt), desc(promotions.id));

  return withTargets(db, rows);
}

async function findPromotion(database: Database, id: string) {
  const [promotion] = await database.select().from(promotions).where(eq(promotions.id, id));
  if (!promotion) notFound(id);

  const [withIds] = await withTargets(database, [promotion]);
  return withIds ?? notFound(id);
}

export function getPromotion(id: string) {
  return findPromotion(db, id);
}

export async function createPromotion({
  productIds = [],
  categoryIds = [],
  ...data
}: CreatePromotionBody) {
  const values = checkPromotion(data, productIds, categoryIds);

  try {
    const promotion = await db.transaction(async (tx) => {
      const [created] = await tx.insert(promotions).values(values).returning();
      if (!created) throw new AppError(500, 'Failed to create promotion');

      await saveTargets(tx, created.id, productIds, categoryIds);
      const result = await findPromotion(tx, created.id);

      await recordAudit(tx, {
        entityType: 'promotion',
        entityId: created.id,
        action: 'create',
        changes: changesBetween({}, result, PROMOTION_FIELDS),
      });

      return result;
    });

    logger.info({ promotionId: promotion.id }, 'Promotion added');

    return promotion;
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updatePromotion(
  id: string,
  { productIds, categoryIds, ...data }: UpdatePromotionBody,
) {
  try {
    const promotion = await db.transaction(async (tx) => {
      await tx
        .select({ id: promotions.id })
        .from(promotions)
        .where(eq(promotions.id, id))
        .for('update');
      const {
        productIds: currentProductIds,
        categoryIds: currentCategoryIds,
        ...existingFields
      } = await findPromotion(tx, id);
      const existing = {
        ...existingFields,
        productIds: currentProductIds,
        categoryIds: currentCategoryIds,
      };

      const values = checkPromotion(
        { ...existingFields, ...data },
        productIds ?? currentProductIds,
        categoryIds ?? currentCategoryIds,
      );
      await tx
        .update(promotions)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(promotions.id, id));

      if (productIds) {
        await tx.delete(promotionProducts).where(eq(promotionProducts.promotionId, id));
        await saveTargets(tx, id, productIds, []);
      }

      if (categoryIds) {
        await tx.delete(promotionCategories).where(eq(promotionCategories.promotionId, id));
        await saveTargets(tx, id, [], categoryIds);
      }

      const result = await findPromotion(tx, id);

      await recordAudit(tx, {
        entityType: 'promotion',
        entityId: id,
        action: 'update',
        changes: changesBetween(existing, result, PROMOTION_FIELDS),
      });

      return result;
    });

    logger.info({ promotionId: id, fields: Object.keys(data) }, 'Promotion changed');

    return promotion;
  } catch (error) {
    throw toAppError(error);
  }
}

/** Past orders keep their discounts, as each item copies its promotion's name. */
export async function deletePromotion(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await findPromotion(tx, id);

    await tx.delete(promotions).where(eq(promotions.id, id));

    await recordAudit(tx, {
      entityType: 'promotion',
      entityId: id,
      action: 'delete',
      changes: changesBetween(existing, {}, PROMOTION_FIELDS),
    });
  });

  logger.info({ promotionId: id }, 'Promotion deleted');
}

async function saveTargets(
  tx: Transaction,
  promotionId: string,
  productIds: string[],
  categoryIds: string[],
) {
  if (productIds.length > 0) {
    await tx
      .insert(promotionProducts)
      .values(productIds.map((productId) => ({ promotionId, productId })));
  }

  if (categoryIds.length > 0) {
    await tx
      .insert(promotionCategories)
      .values(categoryIds.map((categoryId) => ({ promotionId, categoryId })));
  }
}

/** Checks the promotion as a whole, and clears the fields its type does not use. */
function checkPromotion<T extends Omit<CreatePromotionBody, 'productIds' | 'categoryIds'>>(
  promotion: T,
  productIds: string[],
  categoryIds: string[],
) {
  if (promotion.startsAt && promotion.endsAt && promotion.endsAt <= promotion.startsAt) {
    throw new AppError(400, 'endsAt must be after startsAt');
  }

  if (promotion.type === 'buy_x_get_y') {
    if (!promotion.buyQuantity || !promotion.getQuantity || !promotion.getPercentOff) {
      throw new AppError(400, 'Buy X get Y needs buyQuantity, getQuantity, and getPercentOff');
    }
    if (productIds.length === 0 && categoryIds.length === 0) {
      throw new AppError(400, 'Buy X get Y needs at least one product or category');
    }
    return { ...promotion, discountType: null, discountValue: null };
  }

  if (!promotion.discountType || !promotion.discountValue) {
    throw new AppError(400, 'A bundle needs discountType and discountValue');
  }
  if (promotion.discountType === 'percent' && promotion.discountValue > 100) {
    throw new AppError(400, 'A percentage bundle can take at most 100% off');
  }
  if (productIds.length < 2 || productIds.length > MAX_BUNDLE_PRODUCTS || categoryIds.length > 0) {
    throw new AppError(
      400,
      `A bundle needs 2 to ${MAX_BUNDLE_PRODUCTS} products, and no categories`,
    );
  }
  return { ...promotion, buyQuantity: null, getQuantity: null, getPercentOff: null };
}

function toAppError(error: unknown) {
  if (hasDbErrorCode(error, FOREIGN_KEY_VIOLATION)) {
    return new AppError(400, 'Product or category does not exist');
  }

  return error;
}

function notFound(id: string): never {
  throw new AppError(404, `Promotion not found: ${id}`);
}
