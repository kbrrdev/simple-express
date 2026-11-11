import type { Request, Response } from 'express';
import * as userService from './user.service';
import type { SetUserRoleBody } from './user.validation';

type IdParams = { id: string };

export async function setRole(req: Request<IdParams>, res: Response) {
  const { roleId } = req.body as SetUserRoleBody;
  const user = await userService.setUserRole(res.locals.auth.userId, req.params.id, roleId);

  res.json({ data: user });
}
