import type { Request, Response } from 'express';
import * as saleService from './sale.service';
import type { CreateSaleBody, UpdateSaleBody } from './sale.validation';

type IdParams = { id: string };

export async function list(_req: Request, res: Response) {
  const items = await saleService.listSales();

  res.json({ data: items, meta: { page: 1, limit: items.length, total: items.length } });
}

export async function get(req: Request<IdParams>, res: Response) {
  res.json({ data: await saleService.getSale(req.params.id) });
}

export async function create(req: Request<object, object, CreateSaleBody>, res: Response) {
  res.status(201).json({ data: await saleService.createSale(req.body) });
}

export async function update(req: Request<IdParams, object, UpdateSaleBody>, res: Response) {
  res.json({ data: await saleService.updateSale(req.params.id, req.body) });
}

export async function remove(req: Request<IdParams>, res: Response) {
  await saleService.deleteSale(req.params.id);
  res.status(204).send();
}
