import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './user.controller';
import { setUserRoleBody, userParams } from './user.validation';

export const userRoutes = Router();

userRoutes.patch(
  '/:id/role',
  requireAuth,
  requireSuperAdmin,
  validate('params', userParams),
  validate('body', setUserRoleBody),
  controller.setRole,
);
