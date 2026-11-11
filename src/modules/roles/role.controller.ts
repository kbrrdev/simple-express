import type { Request, Response } from 'express';
import * as roleService from './role.service';

type IdParams = { id: string };

export function listPermissions(_req: Request, res: Response) {
  res.json({ data: roleService.listPermissions() });
}

export async function list(_req: Request, res: Response) {
  res.json({ data: await roleService.listRoles() });
}

export async function get(req: Request<IdParams>, res: Response) {
  res.json({ data: await roleService.getRole(req.params.id) });
}

export async function create(req: Request, res: Response) {
  res.status(201).json({ data: await roleService.createRole(req.body) });
}

export async function update(req: Request<IdParams>, res: Response) {
  res.json({ data: await roleService.updateRole(req.params.id, req.body) });
}

export async function remove(req: Request<IdParams>, res: Response) {
  await roleService.deleteRole(req.params.id);
  res.status(204).send();
}
