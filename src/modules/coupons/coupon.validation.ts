import Joi from 'joi';

export interface CreateCouponBody {
  code: string;
  discountType: 'percent' | 'fixed' | 'free_shipping';
  discountValue?: number | null;
  maxDiscountCents?: number | null;
  minSubtotalCents?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  allowSaleItems?: boolean;
  allowGuests?: boolean;
  isActive?: boolean;
}

export type UpdateCouponBody = Partial<CreateCouponBody>;

/** Shoppers can type any case, so codes are compared in capitals. */
export const couponCode = Joi.string()
  .trim()
  .uppercase()
  .pattern(/^[A-Z0-9_-]{3,32}$/)
  .messages({
    'string.pattern.base': '{{#label}} must be 3 to 32 letters, digits, - or _',
  });

const cents = Joi.number().integer().min(1).max(2147483647).allow(null);
const count = Joi.number().integer().min(1).max(1000000).allow(null);
const date = Joi.date().iso().allow(null);

const fields = {
  code: couponCode,
  discountType: Joi.string().valid('percent', 'fixed', 'free_shipping'),
  discountValue: cents,
  maxDiscountCents: cents,
  minSubtotalCents: cents,
  startsAt: date,
  endsAt: date,
  usageLimit: count,
  perCustomerLimit: count,
  allowSaleItems: Joi.boolean(),
  allowGuests: Joi.boolean(),
  isActive: Joi.boolean(),
};

export const couponParams = Joi.object({
  id: Joi.string().uuid().required(),
});

export const createCouponBody = Joi.object<CreateCouponBody>({
  ...fields,
  code: couponCode.required(),
  discountType: fields.discountType.required(),
});

export const updateCouponBody = Joi.object<UpdateCouponBody>(fields).min(1);
