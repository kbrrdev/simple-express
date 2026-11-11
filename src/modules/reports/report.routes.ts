import { Router } from 'express';
import { requireAdmin, requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './report.controller';
import { dateRangeQuery, lowStockQuery, salesQuery, topProductsQuery } from './report.validation';

export const reportRoutes = Router();

reportRoutes.use(requireAuth, requireAdmin);

reportRoutes.get('/summary', validate('query', dateRangeQuery), controller.summary);
reportRoutes.get('/sales', validate('query', salesQuery), controller.sales);
reportRoutes.get('/top-products', validate('query', topProductsQuery), controller.topProducts);
reportRoutes.get('/order-status', controller.orderStatus);
reportRoutes.get('/low-stock', validate('query', lowStockQuery), controller.lowStock);
