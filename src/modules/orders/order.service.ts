import { and, asc, count, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { env } from '../../config/env';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { fileUrl } from '../../lib/storage';
import { addresses } from '../addresses/address.schema';
import { assets } from '../assets/asset.schema';
import { users } from '../auth/auth.schema';
import { cartItems } from '../cart/cart.schema';
import { previewCart } from '../cart/cart.service';
import type { CartItemInput } from '../cart/cart.validation';
import { productImages, products, productVariants } from '../products/product.schema';
import { orderItems, orders, type Order, type OrderStatus } from './order.schema';
import type { CreateOrderBody, ListOrdersQuery } from './order.validation';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Database = typeof db | Transaction;
type PricedItem = { unitPriceCents: number; quantity: number };

/** The moves an admin can make. Anything not listed here is rejected. */
const adminTransitions: Partial<Record<OrderStatus, OrderStatus[]>> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
};

const adminOrderFields = { ...getTableColumns(orders), customerEmail: users.email };

/** The only place that sets the fee. A courier's rates would replace this body. */
export async function calculateShipping(
  _items: PricedItem[],
  _address?: { province: string },
): Promise<number> {
  return env.SHIPPING_FEE_CENTS;
}

function priceOrder<T extends PricedItem>(items: T[], shippingCents: number) {
  const rate = Math.round(env.TAX_RATE_PERCENT * 100);
  const pricesIncludeTax = env.PRICES_INCLUDE_TAX;
  const taxOf = (amount: number) =>
    Math.round((amount * rate) / (pricesIncludeTax ? 10000 + rate : 10000));

  const lines = items.map((item) => {
    const lineTotalCents = item.unitPriceCents * item.quantity;
    return { ...item, lineTotalCents, taxCents: taxOf(lineTotalCents) };
  });

  const subtotalCents = lines.reduce((total, line) => total + line.lineTotalCents, 0);
  const taxCents = lines.reduce((total, line) => total + line.taxCents, taxOf(shippingCents));
  const beforeTax = subtotalCents + shippingCents;

  return {
    lines,
    rate,
    pricesIncludeTax,
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents: pricesIncludeTax ? beforeTax : beforeTax + taxCents,
  };
}

function toOrderTotals({ subtotalCents, shippingCents, taxCents, totalCents }: Order) {
  return {
    subtotalCents,
    shippingCents,
    vatableCents: totalCents - taxCents,
    taxCents,
    totalCents,
  };
}

function findItems(database: Database, orderIds: string[]) {
  return database
    .select({ ...getTableColumns(orderItems), path: assets.path })
    .from(orderItems)
    .leftJoin(assets, eq(orderItems.assetId, assets.id))
    .where(inArray(orderItems.orderId, orderIds))
    .orderBy(asc(orderItems.productName), asc(orderItems.id));
}

type ItemRow = Awaited<ReturnType<typeof findItems>>[number];

function toPublicOrder(order: Order, items: ItemRow[]) {
  const { recipientName, phone, line1, line2, barangay, city, province, postalCode } = order;

  return {
    id: order.id,
    orderNumber: `ORD-${String(order.orderNumber).padStart(6, '0')}`,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    ...toOrderTotals(order),
    taxRatePercent: order.taxRateBasisPoints / 100,
    pricesIncludeTax: order.pricesIncludeTax,
    shippingAddress: { recipientName, phone, line1, line2, barangay, city, province, postalCode },
    items: items
      .filter((item) => item.orderId === order.id)
      .map(({ id, variantId, path, orderId: _orderId, assetId: _assetId, ...item }) => ({
        id,
        variantId,
        ...item,
        imageUrl: path ? fileUrl(path) : null,
      })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/** Prices items for the storefront. Unavailable items are shown but not charged. */
export async function previewOrder(items: CartItemInput[]) {
  const cart = await previewCart(items);
  const available = cart.items.filter((item) => item.available);
  const shippingCents = available.length > 0 ? await calculateShipping(available) : 0;
  const pricing = priceOrder(available, shippingCents);

  return {
    items: cart.items,
    subtotalCents: pricing.subtotalCents,
    shippingCents,
    vatableCents: pricing.totalCents - pricing.taxCents,
    taxCents: pricing.taxCents,
    totalCents: pricing.totalCents,
    taxRatePercent: pricing.rate / 100,
    pricesIncludeTax: pricing.pricesIncludeTax,
  };
}

export async function createOrder(userId: string, body: CreateOrderBody) {
  return db.transaction(async (tx) => {
    // One checkout per user at a time, so a double submit cannot buy the same cart twice.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update');

    const [existing] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, body.idempotencyKey)));

    if (existing) {
      return {
        order: toPublicOrder(existing, await findItems(tx, [existing.id])),
        created: false,
      };
    }

    const [address] = await tx
      .select()
      .from(addresses)
      .where(and(eq(addresses.id, body.addressId), eq(addresses.userId, userId)));

    if (!address) throw new AppError(404, `Address not found: ${body.addressId}`);

    const items = await findCheckoutItems(tx, userId);

    if (items.length === 0) throw new AppError(409, 'Cart is empty');

    const unavailable = items.filter((item) => !item.variantActive || !item.productActive);

    if (unavailable.length > 0) {
      throw checkoutError('Some items are no longer available', unavailable, 'is unavailable');
    }

    const shippingCents = await calculateShipping(items, address);
    const pricing = priceOrder(items, shippingCents);

    if (pricing.totalCents !== body.expectedTotalCents) {
      throw new AppError(409, 'The order total has changed');
    }

    await reduceStock(tx, items);

    const [order] = await tx
      .insert(orders)
      .values({
        userId,
        idempotencyKey: body.idempotencyKey,
        status: 'pending',
        paymentMethod: body.paymentMethod,
        subtotalCents: pricing.subtotalCents,
        shippingCents,
        taxCents: pricing.taxCents,
        totalCents: pricing.totalCents,
        taxRateBasisPoints: pricing.rate,
        pricesIncludeTax: pricing.pricesIncludeTax,
        recipientName: address.recipientName,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2,
        barangay: address.barangay,
        city: address.city,
        province: address.province,
        postalCode: address.postalCode,
      })
      .returning();
    if (!order) throw new AppError(500, 'Failed to create order');

    const assetIds = await findItemAssets(tx, items);

    await tx.insert(orderItems).values(
      pricing.lines.map((line) => ({
        orderId: order.id,
        variantId: line.variantId,
        assetId: assetIds.get(line.variantId),
        productName: line.productName,
        option1Name: line.option1Name,
        option1Value: line.option1Value,
        option2Name: line.option2Name,
        option2Value: line.option2Value,
        unitPriceCents: line.unitPriceCents,
        quantity: line.quantity,
        taxCents: line.taxCents,
        lineTotalCents: line.lineTotalCents,
      })),
    );

    await tx.delete(cartItems).where(eq(cartItems.userId, userId));

    return { order: toPublicOrder(order, await findItems(tx, [order.id])), created: true };
  });
}

export async function listOrders(userId: string, { page, limit, status }: ListOrdersQuery) {
  const where = and(eq(orders.userId, userId), status ? eq(orders.status, status) : undefined);

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(orders).where(where),
  ]);

  const items = await findItems(
    db,
    rows.map((row) => row.id),
  );

  return { items: rows.map((row) => toPublicOrder(row, items)), total: totals[0]?.total ?? 0 };
}

export async function getOrder(userId: string, id: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.userId, userId)));

  if (!order) notFound(id);

  return toPublicOrder(order, await findItems(db, [id]));
}

export async function cancelOwnOrder(userId: string, id: string) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.userId, userId)))
      .for('update');

    if (!order) notFound(id);

    if (order.status !== 'pending') {
      throw new AppError(409, 'This order can no longer be cancelled');
    }

    const cancelled = await cancelOrder(tx, order);

    return toPublicOrder(cancelled, await findItems(tx, [id]));
  });
}

export async function listAllOrders({ page, limit, status }: ListOrdersQuery) {
  const where = status ? eq(orders.status, status) : undefined;

  const [rows, totals] = await Promise.all([
    db
      .select(adminOrderFields)
      .from(orders)
      .leftJoin(users, eq(orders.userId, users.id))
      .where(where)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(orders).where(where),
  ]);

  const items = await findItems(
    db,
    rows.map((row) => row.id),
  );

  return {
    items: rows.map((row) => toAdminOrder(row, items)),
    total: totals[0]?.total ?? 0,
  };
}

export async function getAnyOrder(id: string) {
  const [order] = await db
    .select(adminOrderFields)
    .from(orders)
    .leftJoin(users, eq(orders.userId, users.id))
    .where(eq(orders.id, id));

  if (!order) notFound(id);

  return toAdminOrder(order, await findItems(db, [id]));
}

export async function updateOrderStatus(id: string, status: OrderStatus) {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');

    if (!order) notFound(id);

    if (!adminTransitions[order.status]?.includes(status)) {
      throw new AppError(409, `An order cannot move from ${order.status} to ${status}`);
    }

    if (status === 'cancelled') {
      await cancelOrder(tx, order);
      return;
    }

    // Returned stock is left alone, as the item may be damaged. Admins add it back by hand.
    await tx.update(orders).set({ status }).where(eq(orders.id, id));

    // Delivering a COD order means the customer has handed the cash to the courier.
    if (status === 'delivered' && order.paymentMethod === 'cod') {
      await markPaid(tx, id);
    }
  });

  return getAnyOrder(id);
}

/** The only way an order becomes paid, so that a provider's webhook can use it later. */
export async function markPaid(tx: Transaction, orderId: string) {
  await tx.update(orders).set({ paymentStatus: 'paid' }).where(eq(orders.id, orderId));
}

/** Expects the order row to be locked, so that stock is only returned once. */
async function cancelOrder(tx: Transaction, order: Order) {
  const items = await tx
    .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.variantId));

  for (const { variantId, quantity } of items) {
    await tx
      .update(productVariants)
      .set({ stock: sql`${productVariants.stock} + ${quantity}` })
      .where(eq(productVariants.id, variantId));
  }

  const [cancelled] = await tx
    .update(orders)
    .set({ status: 'cancelled' })
    .where(eq(orders.id, order.id))
    .returning();

  return cancelled ?? notFound(order.id);
}

function findCheckoutItems(tx: Transaction, userId: string) {
  return tx
    .select({
      variantId: productVariants.id,
      productId: products.id,
      productName: products.name,
      option1Name: products.option1Name,
      option1Value: productVariants.option1Value,
      option2Name: products.option2Name,
      option2Value: productVariants.option2Value,
      unitPriceCents: productVariants.priceCents,
      variantAssetId: productVariants.assetId,
      variantActive: productVariants.active,
      productActive: products.active,
      quantity: cartItems.quantity,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(cartItems.userId, userId))
    .orderBy(asc(productVariants.id));
}

type CheckoutItem = Awaited<ReturnType<typeof findCheckoutItems>>[number];

/** Items arrive sorted by variant, so parallel checkouts cannot deadlock on each other. */
async function reduceStock(tx: Transaction, items: CheckoutItem[]) {
  const soldOut = [];

  for (const item of items) {
    const [updated] = await tx
      .update(productVariants)
      .set({ stock: sql`${productVariants.stock} - ${item.quantity}` })
      .where(
        and(
          eq(productVariants.id, item.variantId),
          sql`${productVariants.stock} >= ${item.quantity}`,
        ),
      )
      .returning({ id: productVariants.id });

    if (!updated) soldOut.push(item);
  }

  if (soldOut.length > 0) {
    throw checkoutError(
      'Some items do not have enough stock',
      soldOut,
      'does not have enough stock',
    );
  }
}

/** Uses the variant's image, then the product's first image. */
async function findItemAssets(tx: Transaction, items: CheckoutItem[]) {
  const images = await tx
    .select({ productId: productImages.productId, assetId: productImages.assetId })
    .from(productImages)
    .where(
      inArray(
        productImages.productId,
        items.map((item) => item.productId),
      ),
    )
    .orderBy(asc(productImages.position), asc(productImages.createdAt), asc(productImages.id));

  return new Map(
    items.map((item) => [
      item.variantId,
      item.variantAssetId ??
        images.find((image) => image.productId === item.productId)?.assetId ??
        null,
    ]),
  );
}

function toAdminOrder(row: Order & { customerEmail: string | null }, items: ItemRow[]) {
  return {
    ...toPublicOrder(row, items),
    userId: row.userId,
    customerEmail: row.customerEmail,
  };
}

function checkoutError(message: string, items: CheckoutItem[], problem: string) {
  return new AppError(
    409,
    message,
    items.map((item) => ({
      field: item.variantId,
      message: `${item.productName} ${problem}`,
    })),
  );
}

function notFound(id: string): never {
  throw new AppError(404, `Order not found: ${id}`);
}
