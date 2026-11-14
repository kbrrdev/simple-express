import { MAX_CATEGORY_DEPTH } from './category.validation';

const categoryContent = {
  'application/json': {
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: '#/components/schemas/CategoryWithPath' } },
    },
  },
};

const bodyOf = (schema: string) => ({
  required: true,
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } },
});

const badRequest = { $ref: '#/components/responses/BadRequest' };
const unauthorized = { $ref: '#/components/responses/Unauthorized' };
const forbidden = { $ref: '#/components/responses/Forbidden' };
const notFound = { $ref: '#/components/responses/NotFound' };
const conflict = { $ref: '#/components/responses/Conflict' };
const serverError = { $ref: '#/components/responses/ServerError' };
const categoryId = { $ref: '#/components/parameters/CategoryId' };

const tags = ['Categories'];
const security = [{ bearerAuth: [] }];

export const categoryPaths = {
  '/api/categories': {
    get: {
      tags,
      summary: 'List categories by name',
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        200: {
          description: 'A page of categories',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data', 'meta'],
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Category' } },
                  meta: { $ref: '#/components/schemas/PageMeta' },
                },
              },
            },
          },
        },
        400: badRequest,
        500: serverError,
      },
    },
    post: {
      tags,
      summary: 'Create a category (needs categories.manage)',
      security,
      description: `Categories can be up to ${MAX_CATEGORY_DEPTH} levels deep. Names must be unique among categories with the same parent.`,
      requestBody: bodyOf('CreateCategoryBody'),
      responses: {
        201: {
          description: 'The created category',
          headers: {
            Location: { description: 'URL of the created category', schema: { type: 'string' } },
          },
          content: categoryContent,
        },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/categories/tree': {
    get: {
      tags,
      summary: 'Get every category, nested under its parent',
      responses: {
        200: {
          description: 'The top-level categories, each with its children',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/CategoryNode' } },
                },
              },
            },
          },
        },
        500: serverError,
      },
    },
  },
  '/api/categories/{id}': {
    get: {
      tags,
      summary: 'Get a category',
      parameters: [categoryId],
      responses: {
        200: { description: 'The category', content: categoryContent },
        400: badRequest,
        404: notFound,
        500: serverError,
      },
    },
    patch: {
      tags,
      summary: 'Update or move a category (needs categories.manage)',
      description:
        'A new `parentId` moves the category with everything below it, and `null` makes it top-level. A move into its own subtree, or deeper than the limit, returns 400.',
      security,
      parameters: [categoryId],
      requestBody: bodyOf('UpdateCategoryBody'),
      responses: {
        200: { description: 'The updated category', content: categoryContent },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        409: conflict,
        500: serverError,
      },
    },
    delete: {
      tags,
      summary: 'Delete a category (needs categories.manage)',
      description:
        'Fails with 409 while the category has subcategories, or any product, active or not, uses it.',
      security,
      parameters: [categoryId],
      responses: {
        204: { description: 'The category was deleted' },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        409: conflict,
        500: serverError,
      },
    },
  },
};

export const categoryParameters = {
  CategoryId: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
};

const categoryProperties = {
  id: { type: 'string', format: 'uuid' },
  parentId: { type: 'string', format: 'uuid', nullable: true },
  name: { type: 'string', maxLength: 100, example: 'T-Shirts' },
  imageAssetId: { type: 'string', format: 'uuid', nullable: true },
  imageUrl: { type: 'string', format: 'uri', nullable: true },
  icon: {
    type: 'string',
    nullable: true,
    description:
      "An icon name from the frontend's icon set. Show the image if set, otherwise the icon.",
    example: 'shirt',
  },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};

const categoryRequired = [
  'id',
  'parentId',
  'name',
  'imageAssetId',
  'imageUrl',
  'icon',
  'createdAt',
  'updatedAt',
];

const bodyProperties = {
  name: { type: 'string', minLength: 1, maxLength: 100, example: 'T-Shirts' },
  parentId: {
    type: 'string',
    format: 'uuid',
    nullable: true,
    description: 'The parent category, or null for a top-level one',
  },
  imageAssetId: {
    type: 'string',
    format: 'uuid',
    nullable: true,
    description: 'An uploaded asset, or null for no image',
  },
  icon: {
    type: 'string',
    maxLength: 50,
    pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
    nullable: true,
    description: "An icon name from the frontend's icon set, such as Lucide's, or null for none",
    example: 'shirt',
  },
};

export const categorySchemas = {
  Category: { type: 'object', required: categoryRequired, properties: categoryProperties },
  CategoryWithPath: {
    type: 'object',
    required: [...categoryRequired, 'path'],
    properties: {
      ...categoryProperties,
      path: {
        type: 'array',
        description: 'The categories above this one, from the top down',
        items: {
          type: 'object',
          required: ['id', 'name'],
          properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } },
        },
      },
    },
  },
  CategoryNode: {
    type: 'object',
    required: [...categoryRequired, 'children'],
    properties: {
      ...categoryProperties,
      children: { type: 'array', items: { $ref: '#/components/schemas/CategoryNode' } },
    },
  },
  CreateCategoryBody: {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: bodyProperties,
  },
  UpdateCategoryBody: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: bodyProperties,
  },
};
