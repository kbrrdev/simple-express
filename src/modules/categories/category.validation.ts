import Joi from 'joi';

export const MAX_CATEGORY_DEPTH = 3;

export interface ListCategoriesQuery {
  page: number;
  limit: number;
}

export interface CreateCategoryBody {
  name: string;
  parentId?: string | null;
  imageAssetId?: string | null;
}

export type UpdateCategoryBody = Partial<CreateCategoryBody>;

export const categoryParams = Joi.object({
  id: Joi.string().uuid().required(),
});

export const listCategoriesQuery = Joi.object<ListCategoriesQuery>({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const name = Joi.string().trim().min(1).max(100);
const parentId = Joi.string().uuid().allow(null);
const imageAssetId = Joi.string().uuid().allow(null);

export const createCategoryBody = Joi.object<CreateCategoryBody>({
  name: name.required(),
  parentId,
  imageAssetId,
});

export const updateCategoryBody = Joi.object<UpdateCategoryBody>({
  name,
  parentId,
  imageAssetId,
}).min(1);
