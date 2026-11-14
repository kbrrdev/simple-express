import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './page.controller';
import { createPageBody, pageParams, pageSlugParams, updatePageBody } from './page.validation';

export const pageRoutes = Router();

const canManage = [requireAuth, requirePermission('pages.manage')];

pageRoutes.get('/', controller.list);
pageRoutes.post('/', ...canManage, validate('body', createPageBody), controller.create);
// Registered before /:slug, which would otherwise match "admin".
pageRoutes.get('/admin', ...canManage, controller.listForAdmin);
pageRoutes.get('/admin/:id', ...canManage, validate('params', pageParams), controller.getForAdmin);
pageRoutes.patch(
  '/admin/:id',
  ...canManage,
  validate('params', pageParams),
  validate('body', updatePageBody),
  controller.update,
);
pageRoutes.delete('/admin/:id', ...canManage, validate('params', pageParams), controller.remove);
pageRoutes.get('/:slug', validate('params', pageSlugParams), controller.get);
