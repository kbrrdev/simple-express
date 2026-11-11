import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './payment-method.controller';
import {
  createPaymentMethodBody,
  paymentMethodParams,
  updatePaymentMethodBody,
} from './payment-method.validation';

export const paymentMethodRoutes = Router();

paymentMethodRoutes.get('/', controller.list);
paymentMethodRoutes.get(
  '/admin',
  requireAuth,
  requirePermission('payment_methods.manage'),
  controller.listForAdmin,
);
paymentMethodRoutes.post(
  '/',
  requireAuth,
  requirePermission('payment_methods.manage'),
  validate('body', createPaymentMethodBody),
  controller.create,
);
paymentMethodRoutes.patch(
  '/:id',
  requireAuth,
  requirePermission('payment_methods.manage'),
  validate('params', paymentMethodParams),
  validate('body', updatePaymentMethodBody),
  controller.update,
);
paymentMethodRoutes.delete(
  '/:id',
  requireAuth,
  requirePermission('payment_methods.manage'),
  validate('params', paymentMethodParams),
  controller.remove,
);
