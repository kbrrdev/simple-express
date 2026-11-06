import Joi from 'joi';

export interface ListBlogsQuery {
  page: number;
  limit: number;
  published?: boolean;
}

export interface CreateBlogBody {
  title: string;
  content: string;
  author: string;
  published?: boolean;
  coverAssetId?: string | null;
}

export type UpdateBlogBody = Partial<CreateBlogBody>;

export const blogParams = Joi.object({
  id: Joi.string().uuid().required(),
});

export const listBlogsQuery = Joi.object<ListBlogsQuery>({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

export const listAllBlogsQuery = listBlogsQuery.keys({
  published: Joi.boolean(),
});

const title = Joi.string().trim().min(1).max(255);
const content = Joi.string().trim().min(1);
const author = Joi.string().trim().min(1).max(100);
const published = Joi.boolean();
const coverAssetId = Joi.string().uuid().allow(null);

export const createBlogBody = Joi.object<CreateBlogBody>({
  title: title.required(),
  content: content.required(),
  author: author.required(),
  published,
  coverAssetId,
});

export const updateBlogBody = Joi.object<UpdateBlogBody>({
  title,
  content,
  author,
  published,
  coverAssetId,
}).min(1);
