const categoryContent = {
  'application/json': {
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: '#/components/schemas/Category' } },
    },
  },
};

const categoryBody = {
  required: true,
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/CategoryBody' } },
  },
};

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
      summary: 'Create a category (admin)',
      security,
      requestBody: categoryBody,
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
      summary: 'Rename a category (admin)',
      security,
      parameters: [categoryId],
      requestBody: categoryBody,
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
      summary: 'Delete a category (admin)',
      description: 'Fails with 409 while any product, active or not, uses the category.',
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

export const categorySchemas = {
  Category: {
    type: 'object',
    required: ['id', 'name', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string', maxLength: 100, example: 'T-Shirts' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CategoryBody: {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100, example: 'T-Shirts' },
    },
  },
};
