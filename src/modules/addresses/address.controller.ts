import type { Request, Response } from 'express';
import * as addressService from './address.service';
import type { AddressBody, UpdateAddressBody } from './address.validation';

type IdParams = { id: string };

export async function list(_req: Request, res: Response) {
  const items = await addressService.listAddresses(res.locals.auth.userId);

  res.json({
    data: items,
    meta: { page: 1, limit: addressService.MAX_ADDRESSES, total: items.length },
  });
}

export async function get(req: Request<IdParams>, res: Response) {
  res.json({ data: await addressService.getAddress(res.locals.auth.userId, req.params.id) });
}

export async function create(req: Request<object, object, AddressBody>, res: Response) {
  const address = await addressService.createAddress(res.locals.auth.userId, req.body);
  res.status(201).location(`${req.baseUrl}/${address.id}`).json({ data: address });
}

export async function update(req: Request<IdParams, object, UpdateAddressBody>, res: Response) {
  res.json({
    data: await addressService.updateAddress(res.locals.auth.userId, req.params.id, req.body),
  });
}

export async function setDefault(req: Request<IdParams>, res: Response) {
  res.json({ data: await addressService.setDefaultAddress(res.locals.auth.userId, req.params.id) });
}

export async function remove(req: Request<IdParams>, res: Response) {
  await addressService.deleteAddress(res.locals.auth.userId, req.params.id);
  res.status(204).send();
}
