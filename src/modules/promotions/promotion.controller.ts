import type { Request, Response } from 'express';
import * as promotionService from './promotion.service';
import type { CreatePromotionBody, UpdatePromotionBody } from './promotion.validation';

type IdParams = { id: string };

export async function list(_req: Request, res: Response) {
  const items = await promotionService.listPromotions();

  res.json({ data: items, meta: { page: 1, limit: items.length, total: items.length } });
}

export async function get(req: Request<IdParams>, res: Response) {
  res.json({ data: await promotionService.getPromotion(req.params.id) });
}

export async function create(req: Request<object, object, CreatePromotionBody>, res: Response) {
  res.status(201).json({ data: await promotionService.createPromotion(req.body) });
}

export async function update(req: Request<IdParams, object, UpdatePromotionBody>, res: Response) {
  res.json({ data: await promotionService.updatePromotion(req.params.id, req.body) });
}

export async function remove(req: Request<IdParams>, res: Response) {
  await promotionService.deletePromotion(req.params.id);
  res.status(204).send();
}
