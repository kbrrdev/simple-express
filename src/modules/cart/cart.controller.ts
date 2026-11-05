import type { Request, Response } from 'express';
import * as cartService from './cart.service';
import type { CartItemInput, CartItemsBody, UpdateCartItemBody } from './cart.validation';

type ItemParams = { variantId: string };

export async function get(_req: Request, res: Response) {
  res.json({ data: await cartService.getCart(res.locals.auth.userId) });
}

export async function preview(req: Request<object, object, CartItemsBody>, res: Response) {
  res.json({ data: await cartService.previewCart(req.body.items) });
}

export async function merge(req: Request<object, object, CartItemsBody>, res: Response) {
  res.json({ data: await cartService.mergeCart(res.locals.auth.userId, req.body.items) });
}

export async function addItem(req: Request<object, object, CartItemInput>, res: Response) {
  res.json({ data: await cartService.addItem(res.locals.auth.userId, req.body) });
}

export async function updateItem(
  req: Request<ItemParams, object, UpdateCartItemBody>,
  res: Response,
) {
  const { userId } = res.locals.auth;
  res.json({
    data: await cartService.updateItem(userId, req.params.variantId, req.body.quantity),
  });
}

export async function removeItem(req: Request<ItemParams>, res: Response) {
  await cartService.removeItem(res.locals.auth.userId, req.params.variantId);
  res.status(204).send();
}

export async function clear(_req: Request, res: Response) {
  await cartService.clearCart(res.locals.auth.userId);
  res.status(204).send();
}
