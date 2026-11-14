import Joi from 'joi';

export interface CreatePageBody {
  slug: string;
  title: string;
  content: string;
  published?: boolean;
}

export type UpdatePageBody = Partial<CreatePageBody>;

// "admin" is taken by the admin routes, which share the path.
const slug = Joi.string()
  .trim()
  .lowercase()
  .max(100)
  .pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .invalid('admin')
  .messages({
    'string.pattern.base': '{{#label}} must be lowercase letters, numbers, and single dashes',
  });
const title = Joi.string().trim().min(1).max(255);
const content = Joi.string().trim().min(1);
const published = Joi.boolean();

export const pageParams = Joi.object({
  id: Joi.string().uuid().required(),
});

export const pageSlugParams = Joi.object({
  slug: slug.required(),
});

export const createPageBody = Joi.object<CreatePageBody>({
  slug: slug.required(),
  title: title.required(),
  content: content.required(),
  published,
});

export const updatePageBody = Joi.object<UpdatePageBody>({
  slug,
  title,
  content,
  published,
}).min(1);
