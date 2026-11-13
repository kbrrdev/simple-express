import Joi from 'joi';

export interface CreateBannerBody {
  assetId: string;
  mobileAssetId?: string | null;
  altText: string;
  title?: string | null;
  subtitle?: string | null;
  linkUrl?: string | null;
  position?: number;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export type UpdateBannerBody = Partial<CreateBannerBody>;

const assetId = Joi.string().uuid();
const optionalText = (max: number) => Joi.string().trim().min(1).max(max).allow(null);
// A path on the storefront, or an https link. Blocks javascript: and other schemes.
const linkUrl = Joi.string()
  .trim()
  .max(500)
  .pattern(/^(\/(?![/\\])|https:\/\/)\S*$/)
  .allow(null)
  .messages({ 'string.pattern.base': '{{#label}} must start with / or https://' });
const position = Joi.number().integer().min(0).max(1000);
const date = Joi.date().iso().allow(null);

export const bannerParams = Joi.object({
  id: Joi.string().uuid().required(),
});

const altText = Joi.string().trim().min(1).max(200);

const fields = {
  assetId,
  mobileAssetId: assetId.allow(null),
  altText,
  title: optionalText(100),
  subtitle: optionalText(200),
  linkUrl,
  position,
  isActive: Joi.boolean(),
  startsAt: date,
  endsAt: date,
};

export const createBannerBody = Joi.object<CreateBannerBody>({
  ...fields,
  assetId: assetId.required(),
  altText: altText.required(),
});

export const updateBannerBody = Joi.object<UpdateBannerBody>(fields).min(1);
