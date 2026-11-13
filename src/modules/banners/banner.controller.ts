import type { Request, Response } from 'express';
import * as bannerService from './banner.service';
import type { CreateBannerBody, UpdateBannerBody } from './banner.validation';

type IdParams = { id: string };

export async function list(_req: Request, res: Response) {
  const items = await bannerService.listCurrentBanners();

  res.json({ data: items, meta: { page: 1, limit: items.length, total: items.length } });
}

export async function listForAdmin(_req: Request, res: Response) {
  const items = await bannerService.listAllBanners();
  const meta = { page: 1, limit: items.length, total: items.length };

  // Lets the admin app warn before the limit is reached.
  res.json({ data: items, meta: { ...meta, maxBanners: bannerService.MAX_BANNERS } });
}

export async function create(req: Request<object, object, CreateBannerBody>, res: Response) {
  res.status(201).json({ data: await bannerService.createBanner(req.body) });
}

export async function update(req: Request<IdParams, object, UpdateBannerBody>, res: Response) {
  res.json({ data: await bannerService.updateBanner(req.params.id, req.body) });
}

export async function remove(req: Request<IdParams>, res: Response) {
  await bannerService.deleteBanner(req.params.id);
  res.status(204).send();
}
