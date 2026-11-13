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
import { orderItems, orders } from '../orders/order.schema';
import { products, productVariants } from '../products/product.schema';
import type {
  DateRangeQuery,
  LowStockQuery,
  SalesQuery,
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

export async function getSummary(query: DateRangeQuery) {
  const range = resolveRange(query);
  const notCancelled = ne(orders.status, 'cancelled');

  const [placed, items, collected, customers, taxByRate] = await Promise.all([
    db
      .select({
        ordersPlaced: count(),
        cancelledOrders:
          sql<number>`count(*) filter (where ${orders.status} = 'cancelled')`.mapWith(Number),
        grossSalesCents: sumOf(orders.totalCents, notCancelled),
        taxCents: sumOf(orders.taxCents, notCancelled),
        shippingCents: sumOf(orders.shippingCents, notCancelled),
      })
      .from(orders)
      .where(inRange(orders.createdAt, range)),
    db
      .select({
        itemsSold: sumOf(orderItems.quantity),
        discountCents: sumOf(
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
  ]);

  const totals = placed[0];
  const ordersPlaced = totals?.ordersPlaced ?? 0;
  const cancelledOrders = totals?.cancelledOrders ?? 0;
  const grossSalesCents = totals?.grossSalesCents ?? 0;
  const sales = ordersPlaced - cancelledOrders;
  const collectedCents = collected[0]?.collectedCents ?? 0;
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
    discountCents: items[0]?.discountCents ?? 0,
    newCustomers: customers[0]?.newCustomers ?? 0,
    taxByRate: taxByRate.map((row) => ({
      ratePercent: row.taxRateBasisPoints / 100,
      pricesIncludeTax: row.pricesIncludeTax,
      taxableCents: row.totalCents - row.taxCents,
      taxCents: row.taxCents,
    })),
  };
}

interface SalesRow extends Record<string, unknown> {
  date: string;
  orders: string;
  gross_sales_cents: string;
  collected_cents: string;
}

/** One point per day, week, or month, including empty ones, so charts have no gaps. */
export async function getSales({ interval, ...query }: SalesQuery) {
  const range = resolveRange(query);
  const days = (Date.parse(range.to) - Date.parse(range.from)) / DAY_MS + 1;

  if (interval === 'day' && days > MAX_DAILY_RANGE_DAYS) {
    throw new AppError(400, `A daily report can cover up to ${MAX_DAILY_RANGE_DAYS} days`);
  }

  const bucketOf = (column: AnyColumn) =>
    sql`date_trunc(${interval}, ${column} at time zone ${STORE_TIME_ZONE})::date`;

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
        sum(${orders.totalCents}) as gross_sales_cents
      from ${orders}
      where ${placedInRange(range)}
      group by 1
    ),
    collected as (
      select ${bucketOf(orders.paidAt)} as bucket, sum(${orders.totalCents}) as collected_cents
      from ${orders}
      where ${inRange(orders.paidAt, range)}
      group by 1
    )
    select to_char(buckets.bucket, 'YYYY-MM-DD') as date,
      coalesce(placed.orders, 0) as orders,
      coalesce(placed.gross_sales_cents, 0) as gross_sales_cents,
      coalesce(collected.collected_cents, 0) as collected_cents
    from buckets
    left join placed using (bucket)
    left join collected using (bucket)
    order by buckets.bucket
  `);

  return {
    ...range,
    interval,
    points: result.rows.map((row) => ({
      date: row.date,
      orders: Number(row.orders),
      grossSalesCents: Number(row.gross_sales_cents),
      collectedCents: Number(row.collected_cents),
    })),
  };
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

  return { ...range, sort, items };
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

  return { items, total: totals[0]?.total ?? 0 };
}
