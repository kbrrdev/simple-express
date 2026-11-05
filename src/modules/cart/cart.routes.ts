import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './cart.controller';
import {
  addCartItemBody,
  cartItemParams,
  cartItemsBody,
  updateCartItemBody,
} from './cart.validation';

export const cartRoutes = Router();

cartRoutes.get('/', requireAuth, controller.get);
cartRoutes.delete('/', requireAuth, controller.clear);
cartRoutes.post('/preview', validate('body', cartItemsBody), controller.preview);
cartRoutes.post('/merge', requireAuth, validate('body', cartItemsBody), controller.merge);
cartRoutes.post('/items', requireAuth, validate('body', addCartItemBody), controller.addItem);
cartRoutes.patch(
  '/items/:variantId',
  requireAuth,
  validate('params', cartItemParams),
  validate('body', updateCartItemBody),
  controller.updateItem,
);
cartRoutes.delete(
  '/items/:variantId',
  requireAuth,
  validate('params', cartItemParams),
  controller.removeItem,
);
