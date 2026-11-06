import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  lte,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import { env } from '../../config/env';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { hasDbErrorCode, UNIQUE_VIOLATION } from '../../lib/db-errors';
import { fileUrl } from '../../lib/storage';
import { addresses } from '../addresses/address.schema';
import { assets } from '../assets/asset.schema';
import { users } from '../auth/auth.schema';
import { cartItems } from '../cart/cart.schema';
import { previewCart } from '../cart/cart.service';
import type { CartItemInput } from '../cart/cart.validation';
import { paymentMethods } from '../payment-methods/payment-method.schema';
import { productImages, products, productVariants } from '../products/product.schema';
import { orderItems, orders, payments, type Order, type OrderStatus } from './order.schema';
import type { CreateOrderBody, GuestOrderBody, ListOrdersQuery } from './order.validation';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Database = typeof db | Transaction;
type PricedItem = { unitPriceCents: number; quantity: number };

interface PlaceOrderInput {
  owner: { userId: string } | { guestEmail: string };
  address: Omit<GuestOrderBody['address'], 'line2'> & { line2?: string };
  items: CheckoutItem[];
  paymentMethod: string;
  expectedTotalCents: number;
  idempotencyKey: string;
}

const EXPIRY_BATCH_SIZE = 100;

/** The moves an admin can make. Anything not listed here is rejected. */
const adminTransitions: Partial<Record<OrderStatus, OrderStatus[]>> = {
  awaiting_payment: ['cancelled'],
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
};

const adminOrderFields = {
  ...getTableColumns(orders),
  customerEmail: users.email,
  paymentReference: payments.reference,
};

function signGuestOrder(id: string) {
  return createHmac('sha256', env.JWT_SECRET).update(`guest-order:${id}`).digest('base64url');
}

function readGuestToken(token: string) {
  const [id = '', signature = ''] = token.split('.');
  const expected = Buffer.from(signGuestOrder(id));
  const actual = Buffer.from(signature);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;
  return id;
}

function guestOrderById(id: string) {
  return and(eq(orders.id, id), isNull(orders.userId));
}

function guestOrderKey({ email, idempotencyKey }: GuestOrderBody) {
  return and(eq(orders.guestEmail, email), eq(orders.idempotencyKey, idempotencyKey));
}

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
type OrderDetails = { items: ItemRow[]; qrPaths: Map<string, string> };

/** Loads what orders show beyond their own row: their items and the QR to pay with. */
async function findDetails(database: Database, rows: Order[]): Promise<OrderDetails> {
  const items = await findItems(
    database,
    rows.map((row) => row.id),
  );
  const qrAssetIds = rows.flatMap((row) => (row.paymentQrAssetId ? [row.paymentQrAssetId] : []));
  const qrAssets = await database
    .select({ id: assets.id, path: assets.path })
    .from(assets)
    .where(inArray(assets.id, qrAssetIds));

  return { items, qrPaths: new Map(qrAssets.map((asset) => [asset.id, asset.path])) };
}

function toPublicOrder(order: Order, { items, qrPaths }: OrderDetails) {
  const qrPath = order.paymentQrAssetId ? qrPaths.get(order.paymentQrAssetId) : undefined;
  const { recipientName, phone, line1, line2, barangay, city, province, postalCode } = order;

  return {
    id: order.id,
    orderNumber: `ORD-${String(order.orderNumber).padStart(6, '0')}`,
    status: order.status,
    paymentType: order.paymentType,
    paymentProvider: order.paymentProvider,
    paymentStatus: order.paymentStatus,
    paymentDueAt: order.paymentDueAt,
    payment:
      order.status === 'awaiting_payment' && order.paymentType === 'manual'
        ? {
            providerName: order.paymentProvider,
            accountName: order.paymentAccountName,
            accountNumber: order.paymentAccountNumber,
            qrUrl: qrPath ? fileUrl(qrPath) : null,
          }
        : null,
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
        order: toPublicOrder(existing, await findDetails(tx, [existing])),
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

    const order = await placeOrder(tx, { ...body, owner: { userId }, address, items });

    await tx.delete(cartItems).where(eq(cartItems.userId, userId));

    return { order: toPublicOrder(order, await findDetails(tx, [order])), created: true };
  });
}

/** Guests have no cart or saved address, so the request carries both. */
export async function createGuestOrder(body: GuestOrderBody) {
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(orders).where(guestOrderKey(body));

      if (existing) return { order: await toGuestOrder(tx, existing), created: false };

      const items = await findGuestItems(tx, body.items);
      const order = await placeOrder(tx, {
        ...body,
        owner: { guestEmail: body.email },
        items,
      });

      return { order: await toGuestOrder(tx, order), created: true };
    });
  } catch (error) {
    // Two parallel retries with one key: the loser returns the order the winner made.
    if (!hasDbErrorCode(error, UNIQUE_VIOLATION)) throw error;

    const [existing] = await db.select().from(orders).where(guestOrderKey(body));

    if (!existing) throw error;

    return { order: await toGuestOrder(db, existing), created: false };
  }
}

async function placeOrder(tx: Transaction, input: PlaceOrderInput) {
  const { owner, address, items, paymentMethod, expectedTotalCents, idempotencyKey } = input;
  const method = await findPaymentMethod(tx, paymentMethod);

  const unavailable = items.filter((item) => !item.variantActive || !item.productActive);

  if (unavailable.length > 0) {
    throw checkoutError('Some items are no longer available', unavailable, 'is unavailable');
  }

  const shippingCents = await calculateShipping(items, address);
  const pricing = priceOrder(items, shippingCents);

  if (pricing.totalCents !== expectedTotalCents) {
    throw new AppError(409, 'The order total has changed');
  }

  await reduceStock(tx, items);

  const [order] = await tx
    .insert(orders)
    .values({
      ...owner,
      idempotencyKey,
      status: method ? 'awaiting_payment' : 'pending',
      paymentType: method ? 'manual' : 'cod',
      paymentMethodId: method?.id,
      paymentProvider: method?.providerName,
      paymentAccountName: method?.accountName,
      paymentAccountNumber: method?.accountNumber,
      paymentQrAssetId: method?.qrAssetId,
      paymentDueAt: method
        ? new Date(Date.now() + env.PAYMENT_WINDOW_HOURS * 60 * 60 * 1000)
        : null,
      subtotalCents: pricing.subtotalCents,
      shippingCents,
      taxCents: pricing.taxCents,
      totalCents: pricing.totalCents,
      taxRateBasisPoints: pricing.rate,
      pricesIncludeTax: pricing.pricesIncludeTax,
      recipientName: address.recipientName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2 ?? '',
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

  return order;
}

async function findPaymentMethod(tx: Transaction, paymentMethod: string) {
  if (paymentMethod === 'cod') return undefined;

  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.id, paymentMethod), eq(paymentMethods.enabled, true)));

  if (!method) throw new AppError(409, 'This payment method is not available');

  return method;
}

export async function getGuestOrder(token: string) {
  const id = readGuestToken(token);
  const [order] = id ? await db.select().from(orders).where(guestOrderById(id)) : [];

  if (!order) notFound('guest order');

  return toGuestOrder(db, order);
}

export async function submitOwnPayment(userId: string, id: string, reference: string) {
  return lockOrder(and(eq(orders.id, id), eq(orders.userId, userId)), id, async (tx, order) => {
    const updated = await submitPayment(tx, order, reference);
    return toPublicOrder(updated, await findDetails(tx, [updated]));
  });
}

export async function submitGuestPayment(token: string, reference: string) {
  const id = readGuestToken(token);

  if (!id) notFound('guest order');

  return lockOrder(guestOrderById(id), id, async (tx, order) => {
    const updated = await submitPayment(tx, order, reference);
    return toGuestOrder(tx, updated);
  });
}

async function submitPayment(tx: Transaction, order: Order, reference: string) {
  if (order.status !== 'awaiting_payment' || order.paymentStatus !== 'unpaid') {
    throw new AppError(409, 'This order is not waiting for a payment reference');
  }

  try {
    await tx.insert(payments).values({
      orderId: order.id,
      amountCents: order.totalCents,
      provider: order.paymentProvider ?? order.paymentType,
      reference,
    });
  } catch (error) {
    if (hasDbErrorCode(error, UNIQUE_VIOLATION)) {
      throw new AppError(409, 'This payment reference has already been used');
    }
    throw error;
  }

  const [updated] = await tx
    .update(orders)
    .set({ paymentStatus: 'submitted' })
    .where(eq(orders.id, order.id))
    .returning();

  return updated ?? notFound(order.id);
}

export async function confirmPayment(id: string) {
  await lockOrder(eq(orders.id, id), id, async (tx, order) => {
    if (order.paymentStatus !== 'submitted') {
      throw new AppError(409, 'This order has no payment waiting for confirmation');
    }

    await markPaid(tx, id);
  });

  return getAnyOrder(id);
}

export async function rejectPayment(id: string) {
  await lockOrder(eq(orders.id, id), id, async (tx, order) => {
    if (order.paymentStatus !== 'submitted') {
      throw new AppError(409, 'This order has no payment waiting for confirmation');
    }

    await cancelOrder(tx, order);
  });

  return getAnyOrder(id);
}

/** Records a refund made outside the system. Unfinished orders must be cancelled first. */
export async function refundPayment(id: string) {
  await lockOrder(eq(orders.id, id), id, async (tx, order) => {
    if (order.paymentStatus !== 'paid') {
      throw new AppError(409, 'Only a paid order can be refunded');
    }

    if (!['cancelled', 'returned', 'delivered'].includes(order.status)) {
      throw new AppError(409, 'Cancel this order before refunding it');
    }

    await tx.update(orders).set({ paymentStatus: 'refunded' }).where(eq(orders.id, id));
  });

  return getAnyOrder(id);
}

/** Cancels unpaid orders past their deadline. Orders with a submitted reference are left alone. */
export async function expireUnpaidOrders() {
  return db.transaction(async (tx) => {
    // SKIP LOCKED lets several servers run this without blocking or repeating each other.
    const expired = await tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.status, 'awaiting_payment'),
          eq(orders.paymentStatus, 'unpaid'),
          lte(orders.paymentDueAt, new Date()),
        ),
      )
      .limit(EXPIRY_BATCH_SIZE)
      .for('update', { skipLocked: true });

    for (const order of expired) {
      await cancelOrder(tx, order);
    }

    return expired.length;
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

  const details = await findDetails(db, rows);

  return { items: rows.map((row) => toPublicOrder(row, details)), total: totals[0]?.total ?? 0 };
}

export async function getOrder(userId: string, id: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.userId, userId)));

  if (!order) notFound(id);

  return toPublicOrder(order, await findDetails(db, [order]));
}

export async function cancelOwnOrder(userId: string, id: string) {
  return lockOrder(and(eq(orders.id, id), eq(orders.userId, userId)), id, async (tx, order) => {
    const isUnpaid = order.status === 'awaiting_payment' && order.paymentStatus === 'unpaid';

    if (order.status !== 'pending' && !isUnpaid) {
      throw new AppError(409, 'This order can no longer be cancelled');
    }

    const cancelled = await cancelOrder(tx, order);

    return toPublicOrder(cancelled, await findDetails(tx, [cancelled]));
  });
}

export async function listAllOrders({ page, limit, status, paymentStatus }: ListOrdersQuery) {
  const where = and(
    status ? eq(orders.status, status) : undefined,
    paymentStatus ? eq(orders.paymentStatus, paymentStatus) : undefined,
  );

  const [rows, totals] = await Promise.all([
    db
      .select(adminOrderFields)
      .from(orders)
      .leftJoin(users, eq(orders.userId, users.id))
      .leftJoin(payments, eq(payments.orderId, orders.id))
      .where(where)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(orders).where(where),
  ]);

  const details = await findDetails(db, rows);

  return {
    items: rows.map((row) => toAdminOrder(row, details)),
    total: totals[0]?.total ?? 0,
  };
}

export async function getAnyOrder(id: string) {
  const [order] = await db
    .select(adminOrderFields)
    .from(orders)
    .leftJoin(users, eq(orders.userId, users.id))
    .leftJoin(payments, eq(payments.orderId, orders.id))
    .where(eq(orders.id, id));

  if (!order) notFound(id);

  return toAdminOrder(order, await findDetails(db, [order]));
}

export async function updateOrderStatus(id: string, status: OrderStatus) {
  await lockOrder(eq(orders.id, id), id, async (tx, order) => {
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
    if (status === 'delivered' && order.paymentType === 'cod') {
      await markPaid(tx, id);
    }
  });

  return getAnyOrder(id);
}

/**
 * The only way an order becomes paid, so that a provider's webhook can use it later.
 * Repeating it changes nothing, as providers can deliver the same event twice.
 */
export async function markPaid(tx: Transaction, orderId: string) {
  await tx
    .update(orders)
    .set({
      paymentStatus: 'paid',
      paymentDueAt: null,
      status: sql`case when ${orders.status} = 'awaiting_payment' then 'pending'::order_status else ${orders.status} end`,
    })
    .where(and(eq(orders.id, orderId), ne(orders.paymentStatus, 'paid')));
}

/** Locks one order row, so that its status, payment, and stock change only once. */
function lockOrder<T>(
  where: SQL | undefined,
  id: string,
  work: (tx: Transaction, order: Order) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(where).for('update');

    return order ? work(tx, order) : notFound(id);
  });
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
    .set({
      status: 'cancelled',
      paymentDueAt: null,
      paymentStatus: order.paymentStatus === 'submitted' ? 'unpaid' : order.paymentStatus,
    })
    .where(eq(orders.id, order.id))
    .returning();

  return cancelled ?? notFound(order.id);
}

const checkoutItemFields = {
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
};

function findCheckoutItems(tx: Transaction, userId: string) {
  return tx
    .select({
      ...checkoutItemFields,
      quantity: cartItems.quantity,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(cartItems.userId, userId))
    .orderBy(asc(productVariants.id));
}

type CheckoutItem = Awaited<ReturnType<typeof findCheckoutItems>>[number];

async function findGuestItems(tx: Transaction, requested: CartItemInput[]) {
  const rows = await tx
    .select(checkoutItemFields)
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(
      inArray(
        productVariants.id,
        requested.map((item) => item.variantId),
      ),
    )
    .orderBy(asc(productVariants.id));

  const missing = requested.filter((item) => !rows.some((row) => row.variantId === item.variantId));

  if (missing.length > 0) {
    throw new AppError(
      409,
      'Some items are no longer available',
      missing.map((item) => ({ field: item.variantId, message: 'This item is unavailable' })),
    );
  }

  return rows.map((row) => ({
    ...row,
    quantity: requested.find((item) => item.variantId === row.variantId)?.quantity ?? 0,
  }));
}

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

function toAdminOrder(
  row: Order & { customerEmail: string | null; paymentReference: string | null },
  details: OrderDetails,
) {
  return {
    ...toPublicOrder(row, details),
    userId: row.userId,
    isGuest: row.guestEmail !== null,
    customerEmail: row.customerEmail ?? row.guestEmail,
    paymentReference: row.paymentReference,
  };
}

async function toGuestOrder(database: Database, order: Order) {
  return {
    ...toPublicOrder(order, await findDetails(database, [order])),
    guestToken: `${order.id}.${signGuestOrder(order.id)}`,
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
