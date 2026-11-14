import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { logRateLimit } from '../../middleware/rate-limit';
import { optionalAuth, requireAuth, requirePermission } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './order.controller';
import {
  createOrderBody,
  guestOrderBody,
  guestTokenParams,
  listAllOrdersQuery,
  listOrdersQuery,
  orderParams,
  previewOrderBody,
  submitPaymentBody,
  updateOrderStatusBody,
} from './order.validation';

const tooManyRequests = { error: { message: 'Too many requests, try again later' } };

export const guestOrderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooManyRequests,
  handler: logRateLimit,
});

export const guestPaymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooManyRequests,
  handler: logRateLimit,
});

// Stops codes being guessed. Requests without a code, such as every cart change, are not counted.
export const couponLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  skip: (req) => !req.body?.couponCode,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooManyRequests,
  handler: logRateLimit,
});

export const orderRoutes = Router();

orderRoutes.post(
  '/preview',
  couponLimiter,
  optionalAuth,
  validate('body', previewOrderBody),
  controller.preview,
);
orderRoutes.post(
  '/',
  requireAuth,
  couponLimiter,
  validate('body', createOrderBody),
  controller.create,
);
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
  guestPaymentLimiter,
  validate('params', guestTokenParams),
  validate('body', submitPaymentBody),
  controller.submitGuestPayment,
);

// Registered before /:id, which would otherwise match "admin".
orderRoutes.get(
  '/admin',
  requireAuth,
  requirePermission('orders.view'),
  validate('query', listAllOrdersQuery),
  controller.listForAdmin,
);
orderRoutes.get(
  '/admin/:id',
  requireAuth,
  requirePermission('orders.view'),
  validate('params', orderParams),
  controller.getForAdmin,
);
orderRoutes.patch(
  '/admin/:id/status',
  requireAuth,
  requirePermission('orders.manage'),
  validate('params', orderParams),
  validate('body', updateOrderStatusBody),
  controller.updateStatus,
);

orderRoutes.post(
  '/admin/:id/payment/confirm',
  requireAuth,
  requirePermission('orders.manage'),
  validate('params', orderParams),
  controller.confirmPayment,
);
orderRoutes.post(
  '/admin/:id/payment/reject',
  requireAuth,
  requirePermission('orders.manage'),
  validate('params', orderParams),
  controller.rejectPayment,
);
orderRoutes.post(
  '/admin/:id/payment/refund',
  requireAuth,
  requirePermission('orders.refund'),
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
