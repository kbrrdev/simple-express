import Joi from 'joi';

export interface SetUserRoleBody {
  roleId: string | null;
}

export const userParams = Joi.object({
  id: Joi.string().uuid().required(),
});

export const setUserRoleBody = Joi.object<SetUserRoleBody>({
  // null makes the user a customer.
  roleId: Joi.string().uuid().allow(null).required(),
});
