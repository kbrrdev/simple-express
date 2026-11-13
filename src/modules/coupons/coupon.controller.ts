import type { Request, Response } from 'express';
import * as couponService from './coupon.service';
import type { CreateCouponBody, UpdateCouponBody } from './coupon.validation';

type IdParams = { id: string };

export async function list(_req: Request, res: Response) {
  const items = await couponService.listCoupons();

  res.json({ data: items, meta: { page: 1, limit: items.length, total: items.length } });
}

export async function get(req: Request<IdParams>, res: Response) {
  res.json({ data: await couponService.getCoupon(req.params.id) });
}

export async function create(req: Request<object, object, CreateCouponBody>, res: Response) {
  res.status(201).json({ data: await couponService.createCoupon(req.body) });
}

export async function update(req: Request<IdParams, object, UpdateCouponBody>, res: Response) {
  res.json({ data: await couponService.updateCoupon(req.params.id, req.body) });
}

export async function remove(req: Request<IdParams>, res: Response) {
  await couponService.deleteCoupon(req.params.id);
  res.status(204).send();
}
