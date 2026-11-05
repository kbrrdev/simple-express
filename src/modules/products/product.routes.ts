import { Router } from 'express';
import { requireAdmin, requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './product.controller';
import {
  createProductBody,
  listProductsQuery,
  productParams,
  updateProductBody,
  updateVariantBody,
  variantBody,
  variantParams,
} from './product.validation';

export const productRoutes = Router();

productRoutes.get('/', validate('query', listProductsQuery), controller.list);
productRoutes.post(
  '/',
  requireAuth,
  requireAdmin,
  validate('body', createProductBody),
  controller.create,
);
// Registered before /:id, which would otherwise match "admin".
productRoutes.get(
  '/admin',
  requireAuth,
  requireAdmin,
  validate('query', listProductsQuery),
  controller.listForAdmin,
);
productRoutes.get('/:id', validate('params', productParams), controller.get);
productRoutes.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  validate('params', productParams),
  validate('body', updateProductBody),
  controller.update,
);
productRoutes.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  validate('params', productParams),
  controller.remove,
);
productRoutes.post(
  '/:id/variants',
  requireAuth,
  requireAdmin,
  validate('params', productParams),
  validate('body', variantBody),
  controller.addVariant,
);
productRoutes.patch(
  '/:id/variants/:variantId',
  requireAuth,
  requireAdmin,
  validate('params', variantParams),
  validate('body', updateVariantBody),
  controller.updateVariant,
);
productRoutes.delete(
  '/:id/variants/:variantId',
  requireAuth,
  requireAdmin,
  validate('params', variantParams),
  controller.removeVariant,
);
