import Joi from 'joi';
import { allPermissions, type Permission } from './permissions';

export interface CreateRoleBody {
  name: string;
  description?: string;
  permissions: Permission[];
}

export type UpdateRoleBody = Partial<CreateRoleBody>;

const name = Joi.string().trim().min(1).max(50);
const description = Joi.string().trim().max(500).allow('');
const permissionList = Joi.array()
  .items(Joi.string().valid(...allPermissions))
  .unique();

export const roleParams = Joi.object({
  id: Joi.string().uuid().required(),
});

export const createRoleBody = Joi.object<CreateRoleBody>({
  name: name.required(),
  description,
  permissions: permissionList.required(),
});

export const updateRoleBody = Joi.object<UpdateRoleBody>({
  name,
  description,
  permissions: permissionList,
}).min(1);
