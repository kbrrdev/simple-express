import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/require-auth';
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
  requirePermission('blogs.manage'),
  validate('body', createBlogBody),
  controller.create,
);
// Registered before /:id, which would otherwise match "admin".
blogRoutes.get(
  '/admin',
  requireAuth,
  requirePermission('blogs.manage'),
  validate('query', listAllBlogsQuery),
  controller.listForAdmin,
);
blogRoutes.get(
  '/admin/:id',
  requireAuth,
  requirePermission('blogs.manage'),
  validate('params', blogParams),
  controller.getForAdmin,
);
blogRoutes.get('/:id', validate('params', blogParams), controller.get);
blogRoutes.patch(
  '/:id',
  requireAuth,
  requirePermission('blogs.manage'),
  validate('params', blogParams),
  validate('body', updateBlogBody),
  controller.update,
);
blogRoutes.delete(
  '/:id',
  requireAuth,
  requirePermission('blogs.manage'),
  validate('params', blogParams),
  controller.remove,
);
