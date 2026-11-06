import type { Request, Response } from 'express';
import type { CartItemsBody } from '../cart/cart.validation';
import * as orderService from './order.service';
import type { CreateOrderBody, ListOrdersQuery, UpdateOrderStatusBody } from './order.validation';

type IdParams = { id: string };

export async function preview(req: Request<object, object, CartItemsBody>, res: Response) {
  res.json({ data: await orderService.previewOrder(req.body.items) });
}

export async function create(req: Request<object, object, CreateOrderBody>, res: Response) {
  const { order, created } = await orderService.createOrder(res.locals.auth.userId, req.body);

  res
    .status(created ? 201 : 200)
    .location(`${req.baseUrl}/${order.id}`)
    .json({ data: order });
}

export async function list(req: Request, res: Response) {
  // The validate middleware has already converted and defaulted the query.
  const query = req.query as unknown as ListOrdersQuery;
  const { items, total } = await orderService.listOrders(res.locals.auth.userId, query);

  res.json({ data: items, meta: { page: query.page, limit: query.limit, total } });
}

export async function get(req: Request<IdParams>, res: Response) {
  res.json({ data: await orderService.getOrder(res.locals.auth.userId, req.params.id) });
}

export async function cancel(req: Request<IdParams>, res: Response) {
  res.json({ data: await orderService.cancelOwnOrder(res.locals.auth.userId, req.params.id) });
}

export async function listForAdmin(req: Request, res: Response) {
  const query = req.query as unknown as ListOrdersQuery;
  const { items, total } = await orderService.listAllOrders(query);

  res.json({ data: items, meta: { page: query.page, limit: query.limit, total } });
}

export async function getForAdmin(req: Request<IdParams>, res: Response) {
  res.json({ data: await orderService.getAnyOrder(req.params.id) });
}

export async function updateStatus(
  req: Request<IdParams, object, UpdateOrderStatusBody>,
  res: Response,
) {
  res.json({ data: await orderService.updateOrderStatus(req.params.id, req.body.status) });
}
