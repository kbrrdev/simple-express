import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { products, productVariants } from '../products/product.schema';
import { cartItems } from './cart.schema';
import { MAX_ITEM_QUANTITY, type CartItemInput } from './cart.validation';

const itemFields = {
  variantId: productVariants.id,
  productId: products.id,
  productName: products.name,
  option1Name: products.option1Name,
  option1Value: productVariants.option1Value,
  option2Name: products.option2Name,
  option2Value: productVariants.option2Value,
  unitPriceCents: productVariants.priceCents,
  stock: productVariants.stock,
  variantActive: productVariants.active,
  productActive: products.active,
};

type VariantRow = Awaited<ReturnType<typeof findVariants>>[number];

export async function getCart(userId: string) {
  const rows = await db
    .select({ ...itemFields, quantity: cartItems.quantity })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(cartItems.userId, userId))
    .orderBy(asc(cartItems.createdAt), asc(cartItems.variantId));

  return toCart(rows);
}

/** Prices a guest cart without saving it. Variants that no longer exist are left out. */
export async function previewCart(items: CartItemInput[]) {
  const variants = await findVariants(items.map((item) => item.variantId));

  const rows = items.flatMap(({ variantId, quantity }) => {
    const variant = variants.find((row) => row.variantId === variantId);
    return variant ? [{ ...variant, quantity }] : [];
  });

  return toCart(rows);
}

export async function addItem(userId: string, { variantId, quantity }: CartItemInput) {
  const limit = quantityLimit(await findPurchasableVariant(variantId));

  if (quantity > limit) quantityError(limit);

  // Checked in the upsert itself, so parallel requests cannot go over the limit.
  const [item] = await db
    .insert(cartItems)
    .values({ userId, variantId, quantity })
    .onConflictDoUpdate({
      target: [cartItems.userId, cartItems.variantId],
      set: {
        quantity: sql`${cartItems.quantity} + excluded.quantity`,
        updatedAt: new Date(),
      },
      setWhere: sql`${cartItems.quantity} + excluded.quantity <= ${limit}`,
    })
    .returning({ variantId: cartItems.variantId });

  if (!item) quantityError(limit);

  return getCart(userId);
}

export async function updateItem(userId: string, variantId: string, quantity: number) {
  const limit = quantityLimit(await findPurchasableVariant(variantId));

  if (quantity > limit) quantityError(limit);

  const [item] = await db
    .update(cartItems)
    .set({ quantity })
    .where(itemKey(userId, variantId))
    .returning({ variantId: cartItems.variantId });

  if (!item) itemNotFound(variantId);

  return getCart(userId);
}

export async function removeItem(userId: string, variantId: string): Promise<void> {
  const [item] = await db
    .delete(cartItems)
    .where(itemKey(userId, variantId))
    .returning({ variantId: cartItems.variantId });

  if (!item) itemNotFound(variantId);
}

export async function clearCart(userId: string): Promise<void> {
  await db.delete(cartItems).where(eq(cartItems.userId, userId));
}

/**
 * Moves a guest cart into the user's cart after login. An item in both carts keeps the higher
 * quantity instead of the sum, so a retried request cannot increase anything.
 */
export async function mergeCart(userId: string, items: CartItemInput[]) {
  const variants = await findVariants(items.map((item) => item.variantId));
  const adjustments = [];
  const merged = [];

  for (const { variantId, quantity } of items) {
    const variant = variants.find((row) => row.variantId === variantId);
    const limit = variant && isPurchasable(variant) ? quantityLimit(variant) : 0;
    const allowed = Math.min(quantity, limit);

    if (allowed < quantity) {
      adjustments.push({ variantId, requestedQuantity: quantity, addedQuantity: allowed });
    }

    if (allowed > 0) {
      merged.push({ userId, variantId, quantity: allowed });
    }
  }

  if (merged.length > 0) {
    await db
      .insert(cartItems)
      .values(merged)
      .onConflictDoUpdate({
        target: [cartItems.userId, cartItems.variantId],
        set: {
          quantity: sql`greatest(${cartItems.quantity}, excluded.quantity)`,
          updatedAt: new Date(),
        },
      });
  }

  return { ...(await getCart(userId)), adjustments };
}

function findVariants(variantIds: string[]) {
  return db
    .select(itemFields)
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(inArray(productVariants.id, variantIds));
}

async function findPurchasableVariant(variantId: string) {
  const [variant] = await findVariants([variantId]);

  if (!variant || !isPurchasable(variant)) {
    throw new AppError(404, `Variant not available: ${variantId}`);
  }

  return variant;
}

function isPurchasable({ variantActive, productActive }: VariantRow) {
  return variantActive && productActive;
}

function quantityLimit({ stock }: VariantRow) {
  return Math.min(stock, MAX_ITEM_QUANTITY);
}

function toCart(rows: (VariantRow & { quantity: number })[]) {
  const items = rows.map(({ variantActive, productActive, ...row }) => ({
    ...row,
    lineTotalCents: row.unitPriceCents * row.quantity,
    available: variantActive && productActive,
  }));

  const subtotalCents = items
    .filter((item) => item.available)
    .reduce((total, item) => total + item.lineTotalCents, 0);

  return { items, subtotalCents };
}

function itemKey(userId: string, variantId: string) {
  return and(eq(cartItems.userId, userId), eq(cartItems.variantId, variantId));
}

function quantityError(limit: number): never {
  throw new AppError(409, `Quantity cannot exceed ${limit} for this item`);
}

function itemNotFound(variantId: string): never {
  throw new AppError(404, `Item not in cart: ${variantId}`);
}
