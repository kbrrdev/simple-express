import { Router } from 'express';
import { requireAdmin, requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './blog.controller';
import {
  blogParams,
  createBlogBody,
  listAllBlogsQuery,
  listBlogsQuery,
  updateBlogBody,
} from './blog.validation';

export const blogRoutes = Router();

blogRoutes.get('/', validate('query', listBlogsQuery), controller.list);
blogRoutes.post(
  '/',
  requireAuth,
  requireAdmin,
  validate('body', createBlogBody),
  controller.create,
);
// Registered before /:id, which would otherwise match "admin".
blogRoutes.get(
  '/admin',
  requireAuth,
  requireAdmin,
  validate('query', listAllBlogsQuery),
  controller.listForAdmin,
);
blogRoutes.get(
  '/admin/:id',
  requireAuth,
  requireAdmin,
  validate('params', blogParams),
  controller.getForAdmin,
);
blogRoutes.get('/:id', validate('params', blogParams), controller.get);
blogRoutes.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  validate('params', blogParams),
  validate('body', updateBlogBody),
  controller.update,
);
blogRoutes.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  validate('params', blogParams),
  controller.remove,
);
