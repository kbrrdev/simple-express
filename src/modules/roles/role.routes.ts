import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './role.controller';
import { createRoleBody, roleParams, updateRoleBody } from './role.validation';

export const roleRoutes = Router();

roleRoutes.use(requireAuth, requireSuperAdmin);

// Registered before /:id, which would otherwise match "permissions".
roleRoutes.get('/permissions', controller.listPermissions);
roleRoutes.get('/', controller.list);
roleRoutes.post('/', validate('body', createRoleBody), controller.create);
roleRoutes.get('/:id', validate('params', roleParams), controller.get);
roleRoutes.patch(
  '/:id',
  validate('params', roleParams),
  validate('body', updateRoleBody),
  controller.update,
);
roleRoutes.delete('/:id', validate('params', roleParams), controller.remove);
