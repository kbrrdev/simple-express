import Joi from 'joi';

export interface DateRangeQuery {
  from?: string;
  to?: string;
}

/** Adds the same figures for the period just before, worked out in store time. */
interface CompareQuery {
  compare?: 'previous_period';
}

export type SummaryQuery = DateRangeQuery & CompareQuery;

export interface SalesQuery extends DateRangeQuery, CompareQuery {
  interval: 'day' | 'week' | 'month';
}

export interface SalesByQuery extends DateRangeQuery, CompareQuery {
  dimension: 'payment_method' | 'category';
}

export interface TopProductsQuery extends DateRangeQuery {
  limit: number;
  sort: 'quantity' | 'revenue';
}

export interface LowStockQuery {
  page: number;
  limit: number;
  threshold: number;
}

// A calendar day in the store's time zone, such as 2026-03-01.
export const storeDate = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  // Rejects days that do not exist, such as 2026-02-30, which Date would roll into March.
  .custom((value: string, helpers) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    const valid = !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
    return valid ? value : helpers.error('any.invalid');
  })
  .messages({ 'string.pattern.base': '{{#label}} must be a date such as 2026-03-01' });

const dateRange = {
  from: storeDate,
  to: storeDate,
};

const compare = Joi.string().valid('previous_period');

export const summaryQuery = Joi.object<SummaryQuery>({ ...dateRange, compare });

export const salesByQuery = Joi.object<SalesByQuery>({
  ...dateRange,
  compare,
  dimension: Joi.string().valid('payment_method', 'category').required(),
});

export const salesQuery = Joi.object<SalesQuery>({
  ...dateRange,
  compare,
  interval: Joi.string().valid('day', 'week', 'month').default('day'),
});

export const topProductsQuery = Joi.object<TopProductsQuery>({
  ...dateRange,
  limit: Joi.number().integer().min(1).max(100).default(10),
  sort: Joi.string().valid('quantity', 'revenue').default('quantity'),
});

export const lowStockQuery = Joi.object<LowStockQuery>({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  threshold: Joi.number().integer().min(0).max(100000).default(5),
});
