import { Router } from 'express';
import { requireAdmin, requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './category.controller';
import {
  categoryParams,
  createCategoryBody,
  listCategoriesQuery,
  updateCategoryBody,
} from './category.validation';

export const categoryRoutes = Router();

categoryRoutes.get('/', validate('query', listCategoriesQuery), controller.list);
categoryRoutes.get('/tree', controller.tree);
categoryRoutes.post(
  '/',
  requireAuth,
  requireAdmin,
  validate('body', createCategoryBody),
  controller.create,
);
categoryRoutes.get('/:id', validate('params', categoryParams), controller.get);
categoryRoutes.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  validate('params', categoryParams),
  validate('body', updateCategoryBody),
  controller.update,
);
categoryRoutes.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  validate('params', categoryParams),
  controller.remove,
);
