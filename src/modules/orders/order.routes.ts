import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAdmin, requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import { cartItemsBody } from '../cart/cart.validation';
import * as controller from './order.controller';
import {
  createOrderBody,
  guestOrderBody,
  guestTokenParams,
  listAllOrdersQuery,
  listOrdersQuery,
  orderParams,
  submitPaymentBody,
  updateOrderStatusBody,
} from './order.validation';

export const guestOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Too many requests, try again later' } },
});

export const orderRoutes = Router();

orderRoutes.post('/preview', validate('body', cartItemsBody), controller.preview);
orderRoutes.post('/', requireAuth, validate('body', createOrderBody), controller.create);
orderRoutes.get('/', requireAuth, validate('query', listOrdersQuery), controller.list);

orderRoutes.post(
  '/guest',
  guestOrderLimiter,
  validate('body', guestOrderBody),
  controller.createGuest,
);
orderRoutes.get('/guest/:token', validate('params', guestTokenParams), controller.getGuest);
orderRoutes.post(
  '/guest/:token/payment',
  guestOrderLimiter,
  validate('params', guestTokenParams),
  validate('body', submitPaymentBody),
  controller.submitGuestPayment,
);

// Registered before /:id, which would otherwise match "admin".
orderRoutes.get(
  '/admin',
  requireAuth,
  requireAdmin,
  validate('query', listAllOrdersQuery),
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

orderRoutes.post(
  '/admin/:id/payment/confirm',
  requireAuth,
  requireAdmin,
  validate('params', orderParams),
  controller.confirmPayment,
);
orderRoutes.post(
  '/admin/:id/payment/reject',
  requireAuth,
  requireAdmin,
  validate('params', orderParams),
  controller.rejectPayment,
);
orderRoutes.post(
  '/admin/:id/payment/refund',
  requireAuth,
  requireAdmin,
  validate('params', orderParams),
  controller.refundPayment,
);

orderRoutes.get('/:id', requireAuth, validate('params', orderParams), controller.get);
orderRoutes.post(
  '/:id/payment',
  requireAuth,
  validate('params', orderParams),
  validate('body', submitPaymentBody),
  controller.submitPayment,
);
orderRoutes.post('/:id/cancel', requireAuth, validate('params', orderParams), controller.cancel);
