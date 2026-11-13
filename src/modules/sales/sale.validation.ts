import Joi from 'joi';

export interface CreateSaleBody {
  name: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  isActive?: boolean;
  stockCap?: number | null;
  productIds?: string[];
  categoryIds?: string[];
}

export type UpdateSaleBody = Partial<CreateSaleBody>;

const name = Joi.string().trim().min(1).max(100);
const discountType = Joi.string().valid('percent', 'fixed');
const discountValue = Joi.number().integer().min(1).max(2147483647);
const date = Joi.date().iso().allow(null);
const ids = Joi.array().items(Joi.string().uuid()).max(500).unique();

const fields = {
  name,
  discountType,
  discountValue,
  startsAt: date,
  endsAt: date,
  isActive: Joi.boolean(),
  stockCap: Joi.number().integer().min(1).max(1000000).allow(null),
  productIds: ids,
  categoryIds: ids,
};

export const saleParams = Joi.object({
  id: Joi.string().uuid().required(),
});

export const createSaleBody = Joi.object<CreateSaleBody>({
  ...fields,
  name: name.required(),
  discountType: discountType.required(),
  discountValue: discountValue.required(),
});

export const updateSaleBody = Joi.object<UpdateSaleBody>(fields).min(1);
