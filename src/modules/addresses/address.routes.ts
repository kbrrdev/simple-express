import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './address.controller';
import { addressParams, createAddressBody, updateAddressBody } from './address.validation';

export const addressRoutes = Router();

addressRoutes.use(requireAuth);

addressRoutes.get('/', controller.list);
addressRoutes.post('/', validate('body', createAddressBody), controller.create);
addressRoutes.get('/:id', validate('params', addressParams), controller.get);
addressRoutes.patch(
  '/:id',
  validate('params', addressParams),
  validate('body', updateAddressBody),
  controller.update,
);
addressRoutes.delete('/:id', validate('params', addressParams), controller.remove);
addressRoutes.post('/:id/default', validate('params', addressParams), controller.setDefault);
