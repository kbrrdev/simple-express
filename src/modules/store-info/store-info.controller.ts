import type { Request, Response } from 'express';
import * as storeInfoService from './store-info.service';
import type { StoreInfoBody } from './store-info.validation';

export async function get(_req: Request, res: Response) {
  res.json({ data: await storeInfoService.getStoreInfo() });
}

export async function update(req: Request<object, object, StoreInfoBody>, res: Response) {
  res.json({ data: await storeInfoService.updateStoreInfo(req.body) });
}
