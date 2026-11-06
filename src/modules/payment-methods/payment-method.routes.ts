import { Router } from 'express';
import { requireAdmin, requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './payment-method.controller';
import {
  createPaymentMethodBody,
  paymentMethodParams,
  updatePaymentMethodBody,
} from './payment-method.validation';

export const paymentMethodRoutes = Router();

paymentMethodRoutes.get('/', controller.list);
paymentMethodRoutes.get('/admin', requireAuth, requireAdmin, controller.listForAdmin);
paymentMethodRoutes.post(
  '/',
  requireAuth,
  requireAdmin,
  validate('body', createPaymentMethodBody),
  controller.create,
);
paymentMethodRoutes.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  validate('params', paymentMethodParams),
  validate('body', updatePaymentMethodBody),
  controller.update,
);
paymentMethodRoutes.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  validate('params', paymentMethodParams),
  controller.remove,
);
