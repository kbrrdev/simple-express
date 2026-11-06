import Joi from 'joi';

const MAX_POSTGRES_INTEGER = 2147483647;

export interface ListProductsQuery {
  page: number;
  limit: number;
  search?: string;
  categoryId?: string;
  sort: 'newest' | 'name';
}

export interface VariantBody {
  option1Value?: string;
  option2Value?: string;
  priceCents: number;
  stock?: number;
  active?: boolean;
}

export type UpdateVariantBody = Partial<VariantBody> & { assetId?: string | null };

export interface AddImageBody {
  assetId: string;
  altText?: string;
}

export interface UpdateImageBody {
  altText?: string;
  position?: number;
}

export interface CreateProductBody {
  categoryId: string;
  name: string;
  description?: string;
  option1Name?: string;
  option2Name?: string;
  active?: boolean;
  variants: VariantBody[];
}

export type UpdateProductBody = Partial<Omit<CreateProductBody, 'variants'>>;

export const productParams = Joi.object({
  id: Joi.string().uuid().required(),
});

export const variantParams = Joi.object({
  id: Joi.string().uuid().required(),
  variantId: Joi.string().uuid().required(),
});

export const imageParams = Joi.object({
  id: Joi.string().uuid().required(),
  imageId: Joi.string().uuid().required(),
});

export const listProductsQuery = Joi.object<ListProductsQuery>({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().trim().min(1).max(255),
  categoryId: Joi.string().uuid(),
  sort: Joi.string().valid('newest', 'name').default('newest'),
});

const name = Joi.string().trim().min(1).max(255);
const description = Joi.string().trim().max(10000).allow('');
const optionName = Joi.string().trim().min(1).max(50);
const optionValue = Joi.string().trim().min(1).max(100);
const priceCents = Joi.number().integer().min(0).max(MAX_POSTGRES_INTEGER);
const stock = Joi.number().integer().min(0).max(MAX_POSTGRES_INTEGER);

const variantFields = {
  option1Value: optionValue,
  option2Value: optionValue,
  stock,
  active: Joi.boolean(),
};

export const variantBody = Joi.object<VariantBody>({
  ...variantFields,
  priceCents: priceCents.required(),
});

export const updateVariantBody = Joi.object<UpdateVariantBody>({
  ...variantFields,
  priceCents,
  assetId: Joi.string().uuid().allow(null),
}).min(1);

const altText = Joi.string().trim().max(255).allow('');

export const addImageBody = Joi.object<AddImageBody>({
  assetId: Joi.string().uuid().required(),
  altText,
});

export const updateImageBody = Joi.object<UpdateImageBody>({
  altText,
  position: Joi.number().integer().min(0).max(1000),
}).min(1);

export const createProductBody = Joi.object<CreateProductBody>({
  categoryId: Joi.string().uuid().required(),
  name: name.required(),
  description,
  option1Name: optionName,
  option2Name: optionName,
  active: Joi.boolean(),
  variants: Joi.array().items(variantBody).min(1).max(100).required(),
}).with('option2Name', 'option1Name');

export const updateProductBody = Joi.object<UpdateProductBody>({
  categoryId: Joi.string().uuid(),
  name,
  description,
  option1Name: optionName,
  option2Name: optionName,
  active: Joi.boolean(),
}).min(1);
