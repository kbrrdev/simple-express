import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './banner.controller';
import { bannerParams, createBannerBody, updateBannerBody } from './banner.validation';

export const bannerRoutes = Router();

bannerRoutes.get('/', controller.list);
bannerRoutes.get(
  '/admin',
  requireAuth,
  requirePermission('banners.manage'),
  controller.listForAdmin,
);
bannerRoutes.post(
  '/',
  requireAuth,
  requirePermission('banners.manage'),
  validate('body', createBannerBody),
  controller.create,
);
bannerRoutes.patch(
  '/:id',
  requireAuth,
  requirePermission('banners.manage'),
  validate('params', bannerParams),
  validate('body', updateBannerBody),
  controller.update,
);
bannerRoutes.delete(
  '/:id',
  requireAuth,
  requirePermission('banners.manage'),
  validate('params', bannerParams),
  controller.remove,
);
