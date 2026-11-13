import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './coupon.controller';
import { couponParams, createCouponBody, updateCouponBody } from './coupon.validation';

// Shoppers use coupons through the order preview and checkout, so every route here is for admins.
export const couponRoutes = Router();

couponRoutes.use(requireAuth, requirePermission('promotions.manage'));

couponRoutes.get('/', controller.list);
couponRoutes.get('/:id', validate('params', couponParams), controller.get);
couponRoutes.post('/', validate('body', createCouponBody), controller.create);
couponRoutes.patch(
  '/:id',
  validate('params', couponParams),
  validate('body', updateCouponBody),
  controller.update,
);
couponRoutes.delete('/:id', validate('params', couponParams), controller.remove);
