import Joi from 'joi';

export interface CreatePromotionBody {
  name: string;
  type: 'buy_x_get_y' | 'bundle';
  buyQuantity?: number | null;
  getQuantity?: number | null;
  getPercentOff?: number | null;
  discountType?: 'percent' | 'fixed' | null;
  discountValue?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  isActive?: boolean;
  productIds?: string[];
  categoryIds?: string[];
}

export type UpdatePromotionBody = Partial<CreatePromotionBody>;

const quantity = Joi.number().integer().min(1).max(100).allow(null);
const ids = Joi.array().items(Joi.string().uuid()).max(500).unique();
const date = Joi.date().iso().allow(null);

const fields = {
  name: Joi.string().trim().min(1).max(100),
  type: Joi.string().valid('buy_x_get_y', 'bundle'),
  buyQuantity: quantity,
  getQuantity: quantity,
  getPercentOff: Joi.number().integer().min(1).max(100).allow(null),
  discountType: Joi.string().valid('percent', 'fixed').allow(null),
  discountValue: Joi.number().integer().min(1).max(2147483647).allow(null),
  startsAt: date,
  endsAt: date,
  isActive: Joi.boolean(),
  productIds: ids,
  categoryIds: ids,
};

export const promotionParams = Joi.object({
  id: Joi.string().uuid().required(),
});

export const createPromotionBody = Joi.object<CreatePromotionBody>({
  ...fields,
  name: fields.name.required(),
  type: fields.type.required(),
});

export const updatePromotionBody = Joi.object<UpdatePromotionBody>(fields).min(1);
