import type { Request, Response } from 'express';
import * as reportService from './report.service';
import type {
  DateRangeQuery,
  LowStockQuery,
  SalesQuery,
  TopProductsQuery,
} from './report.validation';

export async function summary(req: Request, res: Response) {
  res.json({ data: await reportService.getSummary(req.query as unknown as DateRangeQuery) });
}

export async function sales(req: Request, res: Response) {
  res.json({ data: await reportService.getSales(req.query as unknown as SalesQuery) });
}

export async function topProducts(req: Request, res: Response) {
  res.json({ data: await reportService.getTopProducts(req.query as unknown as TopProductsQuery) });
}

export async function orderStatus(_req: Request, res: Response) {
  res.json({ data: await reportService.getOrderStatus() });
}

export async function lowStock(req: Request, res: Response) {
  const query = req.query as unknown as LowStockQuery;
  const { items, total } = await reportService.getLowStock(query);

  res.json({ data: items, meta: { page: query.page, limit: query.limit, total } });
}
