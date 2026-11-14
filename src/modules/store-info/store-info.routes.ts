import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './store-info.controller';
import { storeInfoBody } from './store-info.validation';

export const storeInfoRoutes = Router();

storeInfoRoutes.get('/', controller.get);
storeInfoRoutes.put(
  '/',
  requireAuth,
  requirePermission('store.manage'),
  validate('body', storeInfoBody),
  controller.update,
);
