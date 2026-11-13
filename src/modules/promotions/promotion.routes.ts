import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './promotion.controller';
import { createPromotionBody, promotionParams, updatePromotionBody } from './promotion.validation';

// Shoppers see promotions on product badges and in cart prices, so every route here is for admins.
export const promotionRoutes = Router();

promotionRoutes.use(requireAuth, requirePermission('promotions.manage'));

promotionRoutes.get('/', controller.list);
promotionRoutes.get('/:id', validate('params', promotionParams), controller.get);
promotionRoutes.post('/', validate('body', createPromotionBody), controller.create);
promotionRoutes.patch(
  '/:id',
  validate('params', promotionParams),
  validate('body', updatePromotionBody),
  controller.update,
);
promotionRoutes.delete('/:id', validate('params', promotionParams), controller.remove);
