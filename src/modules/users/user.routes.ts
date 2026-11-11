import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './user.controller';
import { listUsersQuery, setUserRoleBody, userParams } from './user.validation';

export const userRoutes = Router();

userRoutes.use(requireAuth, requireSuperAdmin);

userRoutes.get('/', validate('query', listUsersQuery), controller.list);
userRoutes.patch(
  '/:id/role',
  validate('params', userParams),
  validate('body', setUserRoleBody),
  controller.setRole,
);
