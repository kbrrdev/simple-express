import type { RequestHandler } from 'express';
import { AppError } from '../lib/app-error';
import { recordStep, setUserId } from '../lib/request-context';
import { verifyAccessToken } from '../modules/auth/auth.service';
import type { Permission } from '../modules/roles/permissions';
import { SUPER_ADMIN_ROLE_ID } from '../modules/roles/role.schema';

export const requireAuth: RequestHandler = async (req, res, next) => {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];

  if (scheme !== 'Bearer' || !token) {
    throw new AppError(401, 'Missing access token');
  }

  const auth = await verifyAccessToken(token);

  res.locals.auth = auth;
  setUserId(auth.userId);
  recordStep('Authenticated');
  next();
};

/** Use after requireAuth. Permissions are read on every request, so changes apply at once. */
export function requirePermission(permission: Permission): RequestHandler {
  return (_req, res, next) => {
    const granted: Permission[] = res.locals.auth.permissions;

    if (!granted.includes(permission)) {
      throw new AppError(403, 'You do not have permission to do this');
    }

    recordStep(`Permission ${permission} checked`);
    next();
  };
}

/** Use after requireAuth. Managing roles is never a permission, so nobody can grant themselves more. */
export const requireSuperAdmin: RequestHandler = (_req, res, next) => {
  if (res.locals.auth.roleId !== SUPER_ADMIN_ROLE_ID) {
    throw new AppError(403, 'Super admin access required');
  }

  recordStep('Super admin check passed');
  next();
};
