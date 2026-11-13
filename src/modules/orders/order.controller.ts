import type { Request, Response } from 'express';
import * as orderService from './order.service';
import type {
  CreateOrderBody,
  GuestOrderBody,
  ListOrdersQuery,
  PreviewOrderBody,
  SubmitPaymentBody,
  UpdateOrderStatusBody,
} from './order.validation';

type IdParams = { id: string };
type TokenParams = { token: string };

export async function preview(req: Request<object, object, PreviewOrderBody>, res: Response) {
  const { items, couponCode, email } = req.body;
  const userId: string | undefined = res.locals.auth?.userId;
  const customer = userId ? { userId } : email ? { guestEmail: email } : null;

  res.json({ data: await orderService.previewOrder(items, { couponCode, customer }) });
}

export async function create(req: Request<object, object, CreateOrderBody>, res: Response) {
  const { order, created } = await orderService.createOrder(res.locals.auth.userId, req.body);

  res
    .status(created ? 201 : 200)
    .location(`${req.baseUrl}/${order.id}`)
    .json({ data: order });
}

export async function createGuest(req: Request<object, object, GuestOrderBody>, res: Response) {
  const { order, created } = await orderService.createGuestOrder(req.body);

  res.set('Cache-Control', 'no-store');
  res.status(created ? 201 : 200).json({ data: order });
}

export async function getGuest(req: Request<TokenParams>, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await orderService.getGuestOrder(req.params.token) });
}

export async function submitGuestPayment(
  req: Request<TokenParams, object, SubmitPaymentBody>,
  res: Response,
) {
  res.set('Cache-Control', 'no-store');
  res.json({
    data: await orderService.submitGuestPayment(req.params.token, req.body.reference),
  });
}

export async function submitPayment(
  req: Request<IdParams, object, SubmitPaymentBody>,
  res: Response,
) {
  const { userId } = res.locals.auth;
  res.json({
    data: await orderService.submitOwnPayment(userId, req.params.id, req.body.reference),
  });
}

export async function confirmPayment(req: Request<IdParams>, res: Response) {
  res.json({ data: await orderService.confirmPayment(req.params.id) });
}

export async function rejectPayment(req: Request<IdParams>, res: Response) {
  res.json({ data: await orderService.rejectPayment(req.params.id) });
}

export async function refundPayment(req: Request<IdParams>, res: Response) {
  res.json({ data: await orderService.refundPayment(req.params.id) });
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
