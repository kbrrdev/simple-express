import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { CHECK_VIOLATION, FOREIGN_KEY_VIOLATION, hasDbErrorCode } from '../../lib/db-errors';
import { logger } from '../../lib/logger';
import { changesBetween, recordAudit } from '../audit-logs/audit-log.service';
import { categories } from '../categories/category.schema';
import { orderItems } from '../orders/order.schema';
import { saleCategories, saleProducts, sales, type Sale } from './sale.schema';
import type { CreateSaleBody, UpdateSaleBody } from './sale.validation';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Database = typeof db | Transaction;

const MAX_PERCENT_OFF = 90;
const SALE_FIELDS = [
  'name',
  'discountType',
  'discountValue',
  'startsAt',
  'endsAt',
  'isActive',
  'stockCap',
  'productIds',
  'categoryIds',
];

export interface PricedVariant {
  variantId: string;
  productId: string;
  categoryId: string;
  priceCents: number;
  /** Set when buying, so that a stock cap covers every unit in the cart. */
  quantity?: number;
}

export interface SalePrice {
  saleId: string | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  saleEndsAt: Date | null;
}

/** The price each variant sells at now, using the sale that gives the lowest price. */
/** Sales running now that still have units left at the sale price. */
function findCurrentSales(database: Database) {
  const now = new Date();
  return database
    .select()
    .from(sales)
    .where(
      and(
        eq(sales.isActive, true),
        or(isNull(sales.startsAt), lte(sales.startsAt, now)),
        or(isNull(sales.endsAt), gt(sales.endsAt, now)),
        or(isNull(sales.stockCap), lt(sales.soldCount, sales.stockCap)),
      ),
    );
}

/** The products and categories that current sales cover, for listing what is on sale. */
export async function findOnSaleTargets() {
  const current = await findCurrentSales(db);
  const targets = await findTargets(
    db,
    current.map((sale) => sale.id),
  );

  return {
    productIds: targets.productIds.map((row) => row.productId),
    categoryIds: targets.categoryIds.map((row) => row.categoryId),
  };
}

export async function findSalePrices(database: Database, variants: PricedVariant[]) {
  const current = await findCurrentSales(database);

  const targets = await findTargets(
    database,
    current.map((sale) => sale.id),
  );
  const ancestorsOf = await categoryAncestors(database, targets.categoryIds.length > 0);

  const candidates = new Map(
    variants.map((variant) => {
      const categoryIds = ancestorsOf(variant.categoryId);
      const matching = current.filter(
        (sale) =>
          targets.productIds.some(
            (row) => row.saleId === sale.id && row.productId === variant.productId,
          ) ||
          targets.categoryIds.some(
            (row) => row.saleId === sale.id && categoryIds.includes(row.categoryId),
          ),
      );
      return [variant.variantId, matching];
    }),
  );

  // A capped sale only applies when every unit bought from it fits under the cap.
  const excluded = new Set<string>();

  for (;;) {
    const prices = new Map(
      variants.map((variant) => [
        variant.variantId,
        bestPrice(
          variant.priceCents,
          (candidates.get(variant.variantId) ?? []).filter((sale) => !excluded.has(sale.id)),
        ),
      ]),
    );

    const over = current.find((sale) => {
      if (sale.stockCap === null || excluded.has(sale.id)) return false;
      const units = variants
        .filter((variant) => prices.get(variant.variantId)?.saleId === sale.id)
        .reduce((total, variant) => total + (variant.quantity ?? 0), 0);
      return sale.soldCount + units > sale.stockCap;
    });

    if (!over) return prices;
    excluded.add(over.id);
  }
}

function bestPrice(priceCents: number, candidates: Sale[]): SalePrice {
  let best: SalePrice = { saleId: null, priceCents, compareAtPriceCents: null, saleEndsAt: null };

  for (const sale of candidates) {
    const discount =
      sale.discountType === 'percent'
        ? Math.round((priceCents * sale.discountValue) / 100)
        : sale.discountValue;
    const salePrice = Math.max(priceCents - discount, 0);

    if (salePrice < best.priceCents) {
      best = {
        saleId: sale.id,
        priceCents: salePrice,
        compareAtPriceCents: priceCents,
        saleEndsAt: sale.endsAt,
      };
    }
  }

  return best;
}

/** Each category with its parents, as a sale on a category covers its subcategories. */
export async function categoryAncestors(database: Database, needed: boolean) {
  // Stores have few categories, so they are read whole, as the category module does.
  const rows = needed
    ? await database.select({ id: categories.id, parentId: categories.parentId }).from(categories)
    : [];
  const parents = new Map(rows.map((row) => [row.id, row.parentId]));

  return (categoryId: string) => {
    const ids = [categoryId];
    let parent = parents.get(categoryId);
    while (parent && !ids.includes(parent)) {
      ids.push(parent);
      parent = parents.get(parent);
    }
    return ids;
  };
}

/**
 * Counts units against capped sales, in the checkout's transaction. The conditional update
 * stops parallel checkouts going past the cap. Uncapped sales are not counted, so that
 * checkouts do not queue on a busy sale's row.
 */
export async function claimSaleStock(
  tx: Transaction,
  lines: { saleId: string | null; quantity: number }[],
) {
  const units = new Map<string, number>();
  for (const { saleId, quantity } of lines) {
    if (saleId) units.set(saleId, (units.get(saleId) ?? 0) + quantity);
  }
  if (units.size === 0) return false;

  // In ID order, so that parallel checkouts cannot deadlock on each other.
  const capped = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(and(inArray(sales.id, [...units.keys()]), isNotNull(sales.stockCap)))
    .orderBy(asc(sales.id));

  for (const { id } of capped) {
    const quantity = units.get(id) ?? 0;
    const [claimed] = await tx
      .update(sales)
      .set({ soldCount: sql`${sales.soldCount} + ${quantity}` })
      .where(and(eq(sales.id, id), sql`${sales.soldCount} + ${quantity} <= ${sales.stockCap}`))
      .returning({ id: sales.id });

    if (!claimed) throw new AppError(409, 'The order total has changed, as a sale has sold out');
  }

  return capped.length > 0;
}

/** Gives a cancelled order's units back to their capped sales. */
export async function releaseSaleStock(tx: Transaction, orderId: string) {
  const items = await tx
    .select({ saleId: orderItems.saleId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), isNotNull(orderItems.saleId)))
    .orderBy(asc(orderItems.saleId));

  for (const { saleId, quantity } of items) {
    if (!saleId) continue;
    await tx
      .update(sales)
      .set({ soldCount: sql`greatest(${sales.soldCount} - ${quantity}, 0)` })
      .where(and(eq(sales.id, saleId), isNotNull(sales.stockCap)));
  }
}

async function findTargets(database: Database, saleIds: string[]) {
  if (saleIds.length === 0) return { productIds: [], categoryIds: [] };

  const [productIds, categoryIds] = await Promise.all([
    database.select().from(saleProducts).where(inArray(saleProducts.saleId, saleIds)),
    database.select().from(saleCategories).where(inArray(saleCategories.saleId, saleIds)),
  ]);

  return { productIds, categoryIds };
}

async function withTargets(database: Database, rows: Sale[]) {
  const targets = await findTargets(
    database,
    rows.map((row) => row.id),
  );

  return rows.map((sale) => ({
    ...sale,
    productIds: targets.productIds
      .filter((row) => row.saleId === sale.id)
      .map((row) => row.productId),
    categoryIds: targets.categoryIds
      .filter((row) => row.saleId === sale.id)
      .map((row) => row.categoryId),
  }));
}

export async function listSales() {
  const rows = await db.select().from(sales).orderBy(desc(sales.createdAt), desc(sales.id));

  return withTargets(db, rows);
}

async function findSale(database: Database, id: string) {
  const [sale] = await database.select().from(sales).where(eq(sales.id, id));
  if (!sale) notFound(id);

  const [withIds] = await withTargets(database, [sale]);
  return withIds ?? notFound(id);
}

export function getSale(id: string) {
  return findSale(db, id);
}

export async function createSale({ productIds = [], categoryIds = [], ...data }: CreateSaleBody) {
  checkSale({ ...data, productIds, categoryIds });

  try {
    const sale = await db.transaction(async (tx) => {
      const [created] = await tx.insert(sales).values(data).returning();
      if (!created) throw new AppError(500, 'Failed to create sale');

      await saveTargets(tx, created.id, productIds, categoryIds);
      const result = await findSale(tx, created.id);

      await recordAudit(tx, {
        entityType: 'sale',
        entityId: created.id,
        action: 'create',
        changes: changesBetween({}, result, SALE_FIELDS),
      });

      return result;
    });

    logger.info({ saleId: sale.id }, 'Sale added');

    return sale;
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updateSale(id: string, { productIds, categoryIds, ...data }: UpdateSaleBody) {
  try {
    const sale = await db.transaction(async (tx) => {
      await tx.select({ id: sales.id }).from(sales).where(eq(sales.id, id)).for('update');
      const existing = await findSale(tx, id);

      checkSale({
        ...existing,
        ...data,
        productIds: productIds ?? existing.productIds,
        categoryIds: categoryIds ?? existing.categoryIds,
      });

      await tx
        .update(sales)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(sales.id, id));

      if (productIds) {
        await tx.delete(saleProducts).where(eq(saleProducts.saleId, id));
        await saveTargets(tx, id, productIds, []);
      }

      if (categoryIds) {
        await tx.delete(saleCategories).where(eq(saleCategories.saleId, id));
        await saveTargets(tx, id, [], categoryIds);
      }

      const result = await findSale(tx, id);
      const fields = Object.keys({ ...data, productIds, categoryIds }).filter((field) =>
        SALE_FIELDS.includes(field),
      );

      await recordAudit(tx, {
        entityType: 'sale',
        entityId: id,
        action: 'update',
        changes: changesBetween(existing, result, fields),
      });

      return result;
    });

    logger.info({ saleId: id, fields: Object.keys(data) }, 'Sale changed');

    return sale;
  } catch (error) {
    throw toAppError(error);
  }
}

/** Past orders keep the prices they were placed with, and lose only the link to the sale. */
export async function deleteSale(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await findSale(tx, id);

    await tx.delete(sales).where(eq(sales.id, id));

    await recordAudit(tx, {
      entityType: 'sale',
      entityId: id,
      action: 'delete',
      changes: changesBetween(existing, {}, SALE_FIELDS),
    });
  });

  logger.info({ saleId: id }, 'Sale deleted');
}

async function saveTargets(
  tx: Transaction,
  saleId: string,
  productIds: string[],
  categoryIds: string[],
) {
  if (productIds.length > 0) {
    await tx.insert(saleProducts).values(productIds.map((productId) => ({ saleId, productId })));
  }

  if (categoryIds.length > 0) {
    await tx
      .insert(saleCategories)
      .values(categoryIds.map((categoryId) => ({ saleId, categoryId })));
  }
}

function checkSale(sale: {
  discountType: 'percent' | 'fixed';
  discountValue: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  productIds: string[];
  categoryIds: string[];
}) {
  if (sale.discountType === 'percent' && sale.discountValue > MAX_PERCENT_OFF) {
    throw new AppError(400, `A percentage sale can take at most ${MAX_PERCENT_OFF}% off`);
  }

  if (sale.startsAt && sale.endsAt && sale.endsAt <= sale.startsAt) {
    throw new AppError(400, 'endsAt must be after startsAt');
  }

  if (sale.productIds.length === 0 && sale.categoryIds.length === 0) {
    throw new AppError(400, 'A sale needs at least one product or category');
  }
}

function toAppError(error: unknown) {
  if (hasDbErrorCode(error, FOREIGN_KEY_VIOLATION)) {
    return new AppError(400, 'Product or category does not exist');
  }

  if (hasDbErrorCode(error, CHECK_VIOLATION)) {
    return new AppError(409, 'stockCap cannot be lower than the units already sold');
  }

  return error;
}

function notFound(id: string): never {
  throw new AppError(404, `Sale not found: ${id}`);
}
