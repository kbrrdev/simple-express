import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNull,
  lt,
  lte,
  ne,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import { db } from '../../db';
import { AppError } from '../../lib/app-error';
import { users } from '../auth/auth.schema';
import { categories } from '../categories/category.schema';
import { orderItems, orders } from '../orders/order.schema';
import { products, productVariants } from '../products/product.schema';
import { findImages } from '../products/product.service';
import type {
  DateRangeQuery,
  LowStockQuery,
  SalesByQuery,
  SalesQuery,
  SummaryQuery,
  TopProductsQuery,
} from './report.validation';

// The store only ships within the Philippines, so days and months follow Manila time.
const STORE_TIME_ZONE = 'Asia/Manila';
const DEFAULT_RANGE_DAYS = 30;
const MAX_DAILY_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

interface DateRange {
  from: string;
  to: string;
}

function today() {
  // en-CA formats dates as 2026-03-01.
  return new Intl.DateTimeFormat('en-CA', { timeZone: STORE_TIME_ZONE }).format(new Date());
}

function addDays(date: string, days: number) {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Fills in the last 30 days when a range is not given. Both days are included. */
function resolveRange({ from, to }: DateRangeQuery): DateRange {
  const end = to ?? today();
  const start = from ?? addDays(end, 1 - DEFAULT_RANGE_DAYS);

  if (start > end) throw new AppError(400, '`from` must be on or before `to`');

  return { from: start, to: end };
}

/** When a day starts in store time. `days` moves it, so 1 gives the start of the next day. */
export function startOfStoreDay(date: string, days = 0) {
  return sql`(${date}::date + ${days}::int)::timestamp at time zone ${STORE_TIME_ZONE}`;
}

/** Matches times from the start of `from` to the end of `to`, in store time. */
function inRange(column: AnyColumn, { from, to }: DateRange) {
  return and(gte(column, startOfStoreDay(from)), lt(column, startOfStoreDay(to, 1)));
}

/** Sums a column, only over rows that match `where` when given. Postgres returns sums as text. */
function sumOf(column: AnyColumn | SQL, where?: SQL) {
  const filter = where ? sql` filter (where ${where})` : sql``;
  return sql<number>`coalesce(sum(${column})${filter}, 0)`.mapWith(Number);
}

const placedInRange = (range: DateRange) =>
  and(inRange(orders.createdAt, range), ne(orders.status, 'cancelled'));

const daysIn = ({ from, to }: DateRange) => (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;

/** The same number of days, ending the day before `from`. */
function previousRange(range: DateRange): DateRange {
  return { from: addDays(range.from, -daysIn(range)), to: addDays(range.from, -1) };
}

/** Percent change, to one decimal place. Null when there is nothing to compare with. */
function percentChange(current: number, previous: number) {
  return previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;
}

const CHANGE_FIELDS = [
  'ordersPlaced',
  'grossSalesCents',
  'averageOrderValueCents',
  'itemsSold',
  'collectedCents',
  'refundedCents',
  'netCollectedCents',
  'discountCents',
  'newCustomers',
  'customers',
  'returningCustomers',
] as const;

export async function getSummary({ compare, ...query }: SummaryQuery) {
  const range = resolveRange(query);
  const current = await summarize(range);
  if (!compare) return current;

  const previous = await summarize(previousRange(range));
  const changes = Object.fromEntries(
    CHANGE_FIELDS.map((field) => [field, percentChange(current[field], previous[field])]),
  );

  return { ...current, previous, changes };
}

async function summarize(range: DateRange) {
  const notCancelled = ne(orders.status, 'cancelled');

  const [placed, items, collected, customers, taxByRate, buyers] = await Promise.all([
    db
      .select({
        ordersPlaced: count(),
        cancelledOrders:
          sql<number>`count(*) filter (where ${orders.status} = 'cancelled')`.mapWith(Number),
        grossSalesCents: sumOf(orders.totalCents, notCancelled),
        taxCents: sumOf(orders.taxCents, notCancelled),
        shippingCents: sumOf(orders.shippingCents, notCancelled),
        couponDiscountCents: sumOf(orders.discountCents, notCancelled),
        promotionDiscountCents: sumOf(orders.promotionDiscountCents, notCancelled),
      })
      .from(orders)
      .where(inRange(orders.createdAt, range)),
    db
      .select({
        itemsSold: sumOf(orderItems.quantity),
        saleDiscountCents: sumOf(
          sql`(${orderItems.listPriceCents} - ${orderItems.unitPriceCents}) * ${orderItems.quantity}`,
        ),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(placedInRange(range)),
    // Refunds are counted against the period the payment arrived in.
    db
      .select({
        collectedCents: sumOf(orders.totalCents),
        refundedCents: sumOf(orders.totalCents, eq(orders.paymentStatus, 'refunded')),
      })
      .from(orders)
      .where(inRange(orders.paidAt, range)),
    db
      .select({ newCustomers: count() })
      .from(users)
      .where(and(isNull(users.roleId), inRange(users.createdAt, range))),
    // Each order keeps the rate it was placed with, so a rate change shows as a second row.
    db
      .select({
        taxRateBasisPoints: orders.taxRateBasisPoints,
        pricesIncludeTax: orders.pricesIncludeTax,
        totalCents: sumOf(orders.totalCents),
        taxCents: sumOf(orders.taxCents),
      })
      .from(orders)
      .where(placedInRange(range))
      .groupBy(orders.taxRateBasisPoints, orders.pricesIncludeTax)
      .orderBy(asc(orders.taxRateBasisPoints), asc(orders.pricesIncludeTax)),
    countBuyers(range),
  ]);

  const totals = placed[0];
  const ordersPlaced = totals?.ordersPlaced ?? 0;
  const cancelledOrders = totals?.cancelledOrders ?? 0;
  const grossSalesCents = totals?.grossSalesCents ?? 0;
  const sales = ordersPlaced - cancelledOrders;
  const collectedCents = collected[0]?.collectedCents ?? 0;
  const saleDiscountCents = items[0]?.saleDiscountCents ?? 0;
  const couponDiscountCents = totals?.couponDiscountCents ?? 0;
  const promotionDiscountCents = totals?.promotionDiscountCents ?? 0;
  const refundedCents = collected[0]?.refundedCents ?? 0;

  return {
    ...range,
    ordersPlaced,
    cancelledOrders,
    grossSalesCents,
    averageOrderValueCents: sales > 0 ? Math.round(grossSalesCents / sales) : 0,
    itemsSold: items[0]?.itemsSold ?? 0,
    collectedCents,
    refundedCents,
    netCollectedCents: collectedCents - refundedCents,
    taxCents: totals?.taxCents ?? 0,
    shippingCents: totals?.shippingCents ?? 0,
    discountCents: saleDiscountCents + promotionDiscountCents + couponDiscountCents,
    saleDiscountCents,
    couponDiscountCents,
    promotionDiscountCents,
    newCustomers: customers[0]?.newCustomers ?? 0,
    ...buyers,
    taxByRate: taxByRate.map((row) => ({
      ratePercent: row.taxRateBasisPoints / 100,
      pricesIncludeTax: row.pricesIncludeTax,
      taxableCents: row.totalCents - row.taxCents,
      taxCents: row.taxCents,
    })),
  };
}

/**
 * Distinct buyers in the range, accounts and guest emails alike, and those who had ordered before.
 * Plain SQL, as each buyer's earlier orders are found by the same key.
 */
async function countBuyers(range: DateRange) {
  const result = await db.execute<{ customers: string; returning_customers: string }>(sql`
    with buyers as (
      select distinct coalesce(${orders.userId}::text, lower(${orders.guestEmail})) as buyer
      from ${orders}
      where ${placedInRange(range)}
    )
    select count(*) as customers,
      count(*) filter (where exists (
        select 1 from orders earlier
        where coalesce(earlier.user_id::text, lower(earlier.guest_email)) = buyers.buyer
          and earlier.status <> 'cancelled'
          and earlier.created_at < ${startOfStoreDay(range.from)}
      )) as returning_customers
    from buyers
  `);

  const customers = Number(result.rows[0]?.customers ?? 0);
  const returningCustomers = Number(result.rows[0]?.returning_customers ?? 0);

  return {
    customers,
    returningCustomers,
    returningCustomerRatePercent:
      customers > 0 ? Math.round((returningCustomers / customers) * 1000) / 10 : 0,
  };
}

interface SalesRow extends Record<string, unknown> {
  date: string;
  orders: string;
  gross_sales_cents: string;
  items_sold: string;
  discount_cents: string;
  collected_cents: string;
  refunded_cents: string;
}

export async function getSales({ interval, compare, ...query }: SalesQuery) {
  const range = resolveRange(query);

  if (interval === 'day' && daysIn(range) > MAX_DAILY_RANGE_DAYS) {
    throw new AppError(400, `A daily report can cover up to ${MAX_DAILY_RANGE_DAYS} days`);
  }

  const points = await salesSeries(range, interval, 0);
  if (!compare) return { ...range, interval, points };

  // Earlier orders are moved forward by the period's length into the same buckets, so each
  // previous point lines up with a current one, even for weeks and months.
  const shift = daysIn(range);
  const previousPoints = await salesSeries(range, interval, shift);

  return {
    ...range,
    interval,
    points,
    previous: {
      ...previousRange(range),
      points: previousPoints.map((point) => ({ ...point, date: addDays(point.date, -shift) })),
    },
  };
}

/** One point per day, week, or month of `range`, from orders placed `shiftDays` earlier. */
async function salesSeries(range: DateRange, interval: SalesQuery['interval'], shiftDays: number) {
  const source = { from: addDays(range.from, -shiftDays), to: addDays(range.to, -shiftDays) };
  const bucketOf = (column: AnyColumn) =>
    sql`date_trunc(${interval}, (${column} + make_interval(days => ${shiftDays}::int)) at time zone ${STORE_TIME_ZONE})::date`;

  const result = await db.execute<SalesRow>(sql`
    with buckets as (
      select generate_series(
        date_trunc(${interval}, (${range.from}::date)::timestamp),
        (${range.to}::date)::timestamp,
        ('1 ' || ${interval})::interval
      )::date as bucket
    ),
    placed as (
      select ${bucketOf(orders.createdAt)} as bucket,
        count(*) as orders,
        sum(${orders.totalCents}) as gross_sales_cents,
        sum(${orders.promotionDiscountCents} + ${orders.discountCents}) as order_discount_cents
      from ${orders}
      where ${placedInRange(source)}
      group by 1
    ),
    items as (
      select ${bucketOf(orders.createdAt)} as bucket,
        sum(${orderItems.quantity}) as items_sold,
        sum((${orderItems.listPriceCents} - ${orderItems.unitPriceCents}) * ${orderItems.quantity}) as sale_discount_cents
      from ${orderItems}
      join ${orders} on ${orders.id} = ${orderItems.orderId}
      where ${placedInRange(source)}
      group by 1
    ),
    collected as (
      select ${bucketOf(orders.paidAt)} as bucket,
        sum(${orders.totalCents}) as collected_cents,
        sum(${orders.totalCents}) filter (where ${orders.paymentStatus} = 'refunded') as refunded_cents
      from ${orders}
      where ${inRange(orders.paidAt, source)}
      group by 1
    )
    select to_char(buckets.bucket, 'YYYY-MM-DD') as date,
      coalesce(placed.orders, 0) as orders,
      coalesce(placed.gross_sales_cents, 0) as gross_sales_cents,
      coalesce(items.items_sold, 0) as items_sold,
      coalesce(placed.order_discount_cents, 0) + coalesce(items.sale_discount_cents, 0) as discount_cents,
      coalesce(collected.collected_cents, 0) as collected_cents,
      coalesce(collected.refunded_cents, 0) as refunded_cents
    from buckets
    left join placed using (bucket)
    left join items using (bucket)
    left join collected using (bucket)
    order by buckets.bucket
  `);

  return result.rows.map((row) => {
    const orderCount = Number(row.orders);
    const grossSalesCents = Number(row.gross_sales_cents);
    const collectedCents = Number(row.collected_cents);
    const refundedCents = Number(row.refunded_cents);

    return {
      date: row.date,
      orders: orderCount,
      grossSalesCents,
      averageOrderValueCents: orderCount > 0 ? Math.round(grossSalesCents / orderCount) : 0,
      itemsSold: Number(row.items_sold),
      discountCents: Number(row.discount_cents),
      collectedCents,
      refundedCents,
      netCollectedCents: collectedCents - refundedCents,
    };
  });
}

/** Gross sales and orders by payment method, or by top-level category. */
export async function getSalesBy({ dimension, compare, ...query }: SalesByQuery) {
  const range = resolveRange(query);
  const rows = await salesByRows(range, dimension);
  if (!compare) return { ...range, dimension, rows };

  const previous = previousRange(range);
  return {
    ...range,
    dimension,
    rows,
    previous: { ...previous, rows: await salesByRows(previous, dimension) },
  };
}

async function salesByRows(range: DateRange, dimension: SalesByQuery['dimension']) {
  if (dimension === 'payment_method') {
    const rows = await db
      .select({
        paymentType: orders.paymentType,
        provider: orders.paymentProvider,
        grossSalesCents: sumOf(orders.totalCents),
        orders: count(),
      })
      .from(orders)
      .where(placedInRange(range))
      .groupBy(orders.paymentType, orders.paymentProvider);

    return rows
      .map((row) => ({
        key: row.paymentType === 'cod' ? 'cod' : (row.provider ?? 'manual'),
        label: row.paymentType === 'cod' ? 'Cash on delivery' : (row.provider ?? 'Manual'),
        grossSalesCents: row.grossSalesCents,
        orders: row.orders,
      }))
      .sort((a, b) => b.grossSalesCents - a.grossSalesCents || a.label.localeCompare(b.label));
  }

  // Item totals, without shipping, per order and category, then rolled up to top-level categories.
  const [lines, tree] = await Promise.all([
    db
      .select({
        orderId: orderItems.orderId,
        categoryId: products.categoryId,
        cents: sumOf(orderItems.lineTotalCents),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(placedInRange(range))
      .groupBy(orderItems.orderId, products.categoryId),
    db
      .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
      .from(categories),
  ]);

  const byId = new Map(tree.map((category) => [category.id, category]));
  const topOf = (id: string) => {
    let category = byId.get(id);
    while (category?.parentId) category = byId.get(category.parentId);
    return category;
  };

  const totals = new Map<string, { label: string; grossSalesCents: number; orders: Set<string> }>();
  for (const line of lines) {
    const top = topOf(line.categoryId);
    if (!top) continue;
    const total = totals.get(top.id) ?? { label: top.name, grossSalesCents: 0, orders: new Set() };
    total.grossSalesCents += line.cents;
    total.orders.add(line.orderId);
    totals.set(top.id, total);
  }

  return [...totals]
    .map(([key, total]) => ({
      key,
      label: total.label,
      grossSalesCents: total.grossSalesCents,
      orders: total.orders.size,
    }))
    .sort((a, b) => b.grossSalesCents - a.grossSalesCents || a.label.localeCompare(b.label));
}

/** Grouped by product, so renamed products and all their variants count together. */
export async function getTopProducts({ limit, sort, ...query }: TopProductsQuery) {
  const range = resolveRange(query);
  const quantity = sumOf(orderItems.quantity);
  const revenueCents = sumOf(orderItems.lineTotalCents);

  const items = await db
    .select({
      productId: products.id,
      name: products.name,
      active: products.active,
      quantity,
      revenueCents,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(placedInRange(range))
    .groupBy(products.id)
    .orderBy(desc(sort === 'revenue' ? revenueCents : quantity), asc(products.name))
    .limit(limit);

  const images = items.length > 0 ? await findImages(items.map((item) => item.productId)) : [];

  return {
    ...range,
    sort,
    items: items.map((item) => ({
      ...item,
      imageUrl: images.find((image) => image.productId === item.productId)?.url ?? null,
    })),
  };
}

/** Current counts, not limited to a date range, for what needs doing now. */
export async function getOrderStatus() {
  const counts = await db
    .select({ status: orders.status, paymentStatus: orders.paymentStatus, count: count() })
    .from(orders)
    .groupBy(orders.status, orders.paymentStatus)
    .orderBy(asc(orders.status), asc(orders.paymentStatus));

  const total = (matches: (row: (typeof counts)[number]) => boolean) =>
    counts.filter(matches).reduce((sum, row) => sum + row.count, 0);

  return {
    counts,
    needsAttention: {
      paymentsToConfirm: total((row) => row.paymentStatus === 'submitted'),
      ordersToConfirm: total((row) => row.status === 'pending'),
      ordersToShip: total((row) => row.status === 'confirmed'),
    },
  };
}

/** Variants still on sale that are running out. */
export async function getLowStock({ page, limit, threshold }: LowStockQuery) {
  const onSale = and(
    eq(products.active, true),
    eq(productVariants.active, true),
    lte(productVariants.stock, threshold),
  );

  const [items, totals] = await Promise.all([
    db
      .select({
        variantId: productVariants.id,
        productId: products.id,
        productName: products.name,
        option1Name: products.option1Name,
        option1Value: productVariants.option1Value,
        option2Name: products.option2Name,
        option2Value: productVariants.option2Value,
        stock: productVariants.stock,
        variantAssetId: productVariants.assetId,
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(onSale)
      .orderBy(asc(productVariants.stock), asc(products.name), asc(productVariants.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ total: count() })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(onSale),
  ]);

  const images = items.length > 0 ? await findImages(items.map((item) => item.productId)) : [];

  return {
    items: items.map(({ variantAssetId, ...item }) => {
      const productImages = images.filter((image) => image.productId === item.productId);
      const image =
        productImages.find((candidate) => candidate.assetId === variantAssetId) ?? productImages[0];
      return { ...item, imageUrl: image?.url ?? null };
    }),
    total: totals[0]?.total ?? 0,
  };
}
