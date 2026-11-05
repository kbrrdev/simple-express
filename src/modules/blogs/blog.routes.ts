import { Router, type RequestHandler } from 'express';
import { env } from '../../config/env';
import { AppError } from '../../lib/app-error';
import { requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './blog.controller';
import { blogParams, createBlogBody, listBlogsQuery, updateBlogBody } from './blog.validation';

const requireBlogWriter: RequestHandler = (_req, res, next) => {
  if (res.locals.auth.role !== 'admin' && !env.BLOG_CUSTOMER_WRITES_ENABLED) {
    throw new AppError(403, 'Only admins can write blogs');
  }

  next();
};

export const blogRoutes = Router();

blogRoutes.get('/', validate('query', listBlogsQuery), controller.list);
blogRoutes.post(
  '/',
  requireAuth,
  requireBlogWriter,
  validate('body', createBlogBody),
  controller.create,
);
blogRoutes.get('/:id', validate('params', blogParams), controller.get);
blogRoutes.patch(
  '/:id',
  requireAuth,
  requireBlogWriter,
  validate('params', blogParams),
  validate('body', updateBlogBody),
  controller.update,
);
blogRoutes.delete(
  '/:id',
  requireAuth,
  requireBlogWriter,
  validate('params', blogParams),
  controller.remove,
);
