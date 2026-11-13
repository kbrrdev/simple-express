import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './sale.controller';
import { createSaleBody, saleParams, updateSaleBody } from './sale.validation';

// Shoppers see sales through product, cart, and order prices, so every route here is for admins.
export const saleRoutes = Router();

saleRoutes.use(requireAuth, requirePermission('promotions.manage'));

saleRoutes.get('/', controller.list);
saleRoutes.get('/:id', validate('params', saleParams), controller.get);
saleRoutes.post('/', validate('body', createSaleBody), controller.create);
saleRoutes.patch(
  '/:id',
  validate('params', saleParams),
  validate('body', updateSaleBody),
  controller.update,
);
saleRoutes.delete('/:id', validate('params', saleParams), controller.remove);
