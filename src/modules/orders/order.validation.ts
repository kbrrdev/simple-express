import Joi from 'joi';
import type { AddressBody } from '../addresses/address.validation';
import { createAddressBody } from '../addresses/address.validation';
import { cartItemsList, type CartItemInput } from '../cart/cart.validation';
import type { Order, OrderStatus } from './order.schema';

/** Guests pay nothing to place an order, so this limits how much stock each one can hold. */
export const MAX_GUEST_ORDER_QUANTITY = 10;

export interface ListOrdersQuery {
  page: number;
  limit: number;
  status?: OrderStatus;
  paymentStatus?: Order['paymentStatus'];
}

export interface CreateOrderBody {
  addressId: string;
  paymentMethod: string;
  expectedTotalCents: number;
  idempotencyKey: string;
}

export interface GuestOrderBody {
  email: string;
  address: AddressBody;
  items: CartItemInput[];
  paymentMethod: string;
  expectedTotalCents: number;
  idempotencyKey: string;
}

export interface SubmitPaymentBody {
  reference: string;
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

export const listAllOrdersQuery = Joi.object<ListOrdersQuery>({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid(...orderStatuses),
  paymentStatus: Joi.string().valid('unpaid', 'submitted', 'paid', 'refunded'),
});

export const listOrdersQuery = Joi.object<ListOrdersQuery>({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid(...orderStatuses),
});

export const createOrderBody = Joi.object<CreateOrderBody>({
  addressId: Joi.string().uuid().required(),
  paymentMethod: Joi.alternatives(Joi.string().valid('cod'), Joi.string().uuid()).required(),
  expectedTotalCents: Joi.number().integer().min(0).required(),
  idempotencyKey: Joi.string().uuid().required(),
});

export const guestOrderBody = Joi.object<GuestOrderBody>({
  email: Joi.string().trim().lowercase().email({ tlds: false }).max(255).required(),
  address: createAddressBody.required(),
  items: cartItemsList
    .min(1)
    .required()
    .custom((items: CartItemInput[], helpers) => {
      const total = items.reduce((sum, item) => sum + item.quantity, 0);
      return total > MAX_GUEST_ORDER_QUANTITY ? helpers.error('order.tooLarge') : items;
    })
    .messages({
      'order.tooLarge': `A guest order can have up to ${MAX_GUEST_ORDER_QUANTITY} items`,
    }),
  // Guests cannot pay by COD, as anonymous orders invite fake ones.
  paymentMethod: Joi.string().uuid().required(),
  expectedTotalCents: Joi.number().integer().min(0).required(),
  idempotencyKey: Joi.string().uuid().required(),
});

export const guestTokenParams = Joi.object({
  token: Joi.string().max(120).required(),
});

export const submitPaymentBody = Joi.object<SubmitPaymentBody>({
  reference: Joi.string()
    .trim()
    .min(4)
    .max(100)
    .pattern(/^[A-Za-z0-9-]+$/)
    .required(),
});

export const updateOrderStatusBody = Joi.object<UpdateOrderStatusBody>({
  status: Joi.string()
    .valid('confirmed', 'shipped', 'delivered', 'returned', 'cancelled')
    .required(),
});
