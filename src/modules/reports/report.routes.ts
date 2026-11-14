import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './report.controller';
import {
  lowStockQuery,
  salesByQuery,
  salesQuery,
  summaryQuery,
  topProductsQuery,
} from './report.validation';

export const reportRoutes = Router();

const sales = requirePermission('reports.sales');
const operations = requirePermission('reports.operations');

reportRoutes.use(requireAuth);

reportRoutes.get('/summary', sales, validate('query', summaryQuery), controller.summary);
reportRoutes.get('/sales', sales, validate('query', salesQuery), controller.sales);
reportRoutes.get('/sales-by', sales, validate('query', salesByQuery), controller.salesBy);
reportRoutes.get(
  '/top-products',
  sales,
  validate('query', topProductsQuery),
  controller.topProducts,
);
reportRoutes.get('/order-status', operations, controller.orderStatus);
reportRoutes.get('/low-stock', operations, validate('query', lowStockQuery), controller.lowStock);
