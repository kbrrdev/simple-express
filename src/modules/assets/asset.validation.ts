import Joi from 'joi';

export interface ListAssetsQuery {
  page: number;
  limit: number;
}

export const assetParams = Joi.object({
  id: Joi.string().uuid().required(),
});

export const listAssetsQuery = Joi.object<ListAssetsQuery>({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});
