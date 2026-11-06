import Joi from 'joi';

export interface CreatePaymentMethodBody {
  providerName: string;
  accountName: string;
  accountNumber: string;
  qrAssetId?: string | null;
  enabled?: boolean;
}

export type UpdatePaymentMethodBody = Partial<CreatePaymentMethodBody>;

const text = Joi.string().trim().min(1).max(100);
const qrAssetId = Joi.string().uuid().allow(null);
const enabled = Joi.boolean();

export const paymentMethodParams = Joi.object({
  id: Joi.string().uuid().required(),
});

export const createPaymentMethodBody = Joi.object<CreatePaymentMethodBody>({
  providerName: text.required(),
  accountName: text.required(),
  accountNumber: text.required(),
  qrAssetId,
  enabled,
});

export const updatePaymentMethodBody = Joi.object<UpdatePaymentMethodBody>({
  providerName: text,
  accountName: text,
  accountNumber: text,
  qrAssetId,
  enabled,
}).min(1);
