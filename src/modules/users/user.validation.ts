import Joi from 'joi';

export interface ListUsersQuery {
  page: number;
  limit: number;
  search?: string;
  /** `staff` is everyone with a role, and `customer` everyone without one. */
  type?: 'staff' | 'customer';
  roleId?: string;
}

export interface SetUserRoleBody {
  roleId: string | null;
}

export const listUsersQuery = Joi.object<ListUsersQuery>({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().trim().min(1).max(255),
  type: Joi.string().valid('staff', 'customer'),
  roleId: Joi.string().uuid(),
});

export const userParams = Joi.object({
  id: Joi.string().uuid().required(),
});

export const setUserRoleBody = Joi.object<SetUserRoleBody>({
  // null makes the user a customer.
  roleId: Joi.string().uuid().allow(null).required(),
});
