import { Router, type RequestHandler } from 'express';
import { requireAuth, requirePermission } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './product.controller';
import {
  addImageBody,
  createProductBody,
  imageParams,
  listProductsQuery,
  productParams,
  updateImageBody,
  updateProductBody,
  updateVariantBody,
  variantBody,
  variantParams,
} from './product.validation';

export const productRoutes = Router();

/** Changing only stock needs `inventory.manage`, so staff can count stock without changing prices. */
const canUpdateVariant: RequestHandler = (req, res, next) => {
  const onlyStock = Object.keys(req.body as object).every((field) => field === 'stock');

  return requirePermission(onlyStock ? 'inventory.manage' : 'products.manage')(req, res, next);
};

productRoutes.get('/', validate('query', listProductsQuery), controller.list);
productRoutes.post(
  '/',
  requireAuth,
  requirePermission('products.manage'),
  validate('body', createProductBody),
  controller.create,
);
// Registered before /:id, which would otherwise match "admin".
productRoutes.get(
  '/admin',
  requireAuth,
  requirePermission('products.view'),
  validate('query', listProductsQuery),
  controller.listForAdmin,
);
productRoutes.get(
  '/admin/:id',
  requireAuth,
  requirePermission('products.view'),
  validate('params', productParams),
  controller.getForAdmin,
);
productRoutes.get('/:id', validate('params', productParams), controller.get);
productRoutes.patch(
  '/:id',
  requireAuth,
  requirePermission('products.manage'),
  validate('params', productParams),
  validate('body', updateProductBody),
  controller.update,
);
productRoutes.delete(
  '/:id',
  requireAuth,
  requirePermission('products.manage'),
  validate('params', productParams),
  controller.remove,
);
productRoutes.post(
  '/:id/images',
  requireAuth,
  requirePermission('products.manage'),
  validate('params', productParams),
  validate('body', addImageBody),
  controller.addImage,
);
productRoutes.patch(
  '/:id/images/:imageId',
  requireAuth,
  requirePermission('products.manage'),
  validate('params', imageParams),
  validate('body', updateImageBody),
  controller.updateImage,
);
productRoutes.delete(
  '/:id/images/:imageId',
  requireAuth,
  requirePermission('products.manage'),
  validate('params', imageParams),
  controller.removeImage,
);
productRoutes.post(
  '/:id/variants',
  requireAuth,
  requirePermission('products.manage'),
  validate('params', productParams),
  validate('body', variantBody),
  controller.addVariant,
);
productRoutes.patch(
  '/:id/variants/:variantId',
  requireAuth,
  validate('params', variantParams),
  validate('body', updateVariantBody),
  canUpdateVariant,
  controller.updateVariant,
);
productRoutes.delete(
  '/:id/variants/:variantId',
  requireAuth,
  requirePermission('products.manage'),
  validate('params', variantParams),
  controller.removeVariant,
);
