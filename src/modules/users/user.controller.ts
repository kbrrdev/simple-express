import type { Request, Response } from 'express';
import * as userService from './user.service';
import type { ListUsersQuery, SetUserRoleBody } from './user.validation';

type IdParams = { id: string };

export async function list(req: Request, res: Response) {
  const query = req.query as unknown as ListUsersQuery;
  const { items, total } = await userService.listUsers(query);

  res.json({ data: items, meta: { page: query.page, limit: query.limit, total } });
}

export async function setRole(req: Request<IdParams>, res: Response) {
  const { roleId } = req.body as SetUserRoleBody;
  const user = await userService.setUserRole(res.locals.auth.userId, req.params.id, roleId);

  res.json({ data: user });
}
