import Joi from 'joi';

export const MAX_ITEM_QUANTITY = 99;

export interface CartItemInput {
  variantId: string;
  quantity: number;
}

export interface CartItemsBody {
  items: CartItemInput[];
}

export interface UpdateCartItemBody {
  quantity: number;
}

const variantId = Joi.string().uuid();
const quantity = Joi.number().integer().min(1).max(MAX_ITEM_QUANTITY);

export const cartItemParams = Joi.object({
  variantId: variantId.required(),
});

export const addCartItemBody = Joi.object<CartItemInput>({
  variantId: variantId.required(),
  quantity: quantity.default(1),
});

export const updateCartItemBody = Joi.object<UpdateCartItemBody>({
  quantity: quantity.required(),
});

/** A guest cart sent from the client. */
export const cartItemsList = Joi.array()
  .items(Joi.object({ variantId: variantId.required(), quantity: quantity.required() }))
  .max(100)
  .unique('variantId');

export const cartItemsBody = Joi.object<CartItemsBody>({
  items: cartItemsList.required(),
});
