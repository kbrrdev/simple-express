import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error';
import * as assetService from './asset.service';
import type { ListAssetsQuery } from './asset.validation';

type IdParams = { id: string };

export async function list(req: Request, res: Response) {
  // The validate middleware has already converted and defaulted the query.
  const query = req.query as unknown as ListAssetsQuery;
  const { items, total } = await assetService.listAssets(query);

  res.json({ data: items, meta: { page: query.page, limit: query.limit, total } });
}

export async function create(req: Request, res: Response) {
  if (!req.file) throw new AppError(400, 'Attach an image in the file field');

  res.status(201).json({ data: await assetService.createAsset(req.file.buffer) });
}

export async function remove(req: Request<IdParams>, res: Response) {
  await assetService.deleteAsset(req.params.id);
  res.status(204).send();
}
