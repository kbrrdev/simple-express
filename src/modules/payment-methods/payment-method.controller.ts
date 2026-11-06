import type { Request, Response } from 'express';
import * as paymentMethodService from './payment-method.service';
import type { CreatePaymentMethodBody, UpdatePaymentMethodBody } from './payment-method.validation';

type IdParams = { id: string };

export async function list(_req: Request, res: Response) {
  const items = await paymentMethodService.listEnabledMethods();

  res.json({ data: items, meta: { page: 1, limit: items.length, total: items.length } });
}

export async function listForAdmin(_req: Request, res: Response) {
  const items = await paymentMethodService.listAllMethods();

  res.json({ data: items, meta: { page: 1, limit: items.length, total: items.length } });
}

export async function create(req: Request<object, object, CreatePaymentMethodBody>, res: Response) {
  res.status(201).json({ data: await paymentMethodService.createMethod(req.body) });
}

export async function update(
  req: Request<IdParams, object, UpdatePaymentMethodBody>,
  res: Response,
) {
  res.json({ data: await paymentMethodService.updateMethod(req.params.id, req.body) });
}

export async function remove(req: Request<IdParams>, res: Response) {
  await paymentMethodService.deleteMethod(req.params.id);
  res.status(204).send();
}
