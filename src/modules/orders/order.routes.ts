import { Router } from 'express';
import { requireAdmin, requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import { cartItemsBody } from '../cart/cart.validation';
import * as controller from './order.controller';
import {
  createOrderBody,
  listOrdersQuery,
  orderParams,
  updateOrderStatusBody,
} from './order.validation';

export const orderRoutes = Router();

orderRoutes.post('/preview', validate('body', cartItemsBody), controller.preview);
orderRoutes.post('/', requireAuth, validate('body', createOrderBody), controller.create);
orderRoutes.get('/', requireAuth, validate('query', listOrdersQuery), controller.list);

// Registered before /:id, which would otherwise match "admin".
orderRoutes.get(
  '/admin',
  requireAuth,
  requireAdmin,
  validate('query', listOrdersQuery),
  controller.listForAdmin,
);
orderRoutes.get(
  '/admin/:id',
  requireAuth,
  requireAdmin,
  validate('params', orderParams),
  controller.getForAdmin,
);
orderRoutes.patch(
  '/admin/:id/status',
  requireAuth,
  requireAdmin,
  validate('params', orderParams),
  validate('body', updateOrderStatusBody),
  controller.updateStatus,
);

orderRoutes.get('/:id', requireAuth, validate('params', orderParams), controller.get);
orderRoutes.post('/:id/cancel', requireAuth, validate('params', orderParams), controller.cancel);
