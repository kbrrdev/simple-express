import Joi from 'joi';

export interface ListCategoriesQuery {
  page: number;
  limit: number;
}

export interface CategoryBody {
  name: string;
}

export const categoryParams = Joi.object({
  id: Joi.string().uuid().required(),
});

export const listCategoriesQuery = Joi.object<ListCategoriesQuery>({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

export const categoryBody = Joi.object<CategoryBody>({
  name: Joi.string().trim().min(1).max(100).required(),
});
