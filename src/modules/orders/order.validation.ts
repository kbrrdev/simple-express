import Joi from 'joi';
import type { OrderStatus } from './order.schema';

export interface ListOrdersQuery {
  page: number;
  limit: number;
  status?: OrderStatus;
}

export interface CreateOrderBody {
  addressId: string;
  paymentMethod: 'cod';
  expectedTotalCents: number;
  idempotencyKey: string;
}

export interface UpdateOrderStatusBody {
  status: OrderStatus;
}

const orderStatuses = [
  'awaiting_payment',
  'pending',
  'confirmed',
  'shipped',
  'delivered',
  'returned',
  'cancelled',
];

export const orderParams = Joi.object({
  id: Joi.string().uuid().required(),
});

export const listOrdersQuery = Joi.object<ListOrdersQuery>({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid(...orderStatuses),
});

export const createOrderBody = Joi.object<CreateOrderBody>({
  addressId: Joi.string().uuid().required(),
  paymentMethod: Joi.string().valid('cod').required(),
  expectedTotalCents: Joi.number().integer().min(0).required(),
  idempotencyKey: Joi.string().uuid().required(),
});

export const updateOrderStatusBody = Joi.object<UpdateOrderStatusBody>({
  status: Joi.string()
    .valid('confirmed', 'shipped', 'delivered', 'returned', 'cancelled')
    .required(),
});
