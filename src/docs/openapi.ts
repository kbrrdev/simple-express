import { authPaths, authSchemas } from '../modules/auth/auth.openapi';
import { blogParameters, blogPaths, blogSchemas } from '../modules/blogs/blog.openapi';
import {
  categoryParameters,
  categoryPaths,
  categorySchemas,
} from '../modules/categories/category.openapi';
import {
  productParameters,
  productPaths,
  productSchemas,
} from '../modules/products/product.openapi';

const errorContent = {
  'application/json': { schema: { $ref: '#/components/schemas/Error' } },
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Simple Express API',
    version: '1.0.0',
    description: 'Sample blogs API.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Health' },
    { name: 'Auth' },
    { name: 'Blogs' },
    { name: 'Categories' },
    { name: 'Products' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Check the API and database',
        responses: {
          200: {
            description: 'The API and database are available',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status'],
                  properties: { status: { type: 'string', example: 'ok' } },
                },
              },
            },
          },
          500: { $ref: '#/components/responses/ServerError' },
        },
      },
    },
    ...authPaths,
    ...blogPaths,
    ...categoryPaths,
    ...productPaths,
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    parameters: {
      ...blogParameters,
      ...categoryParameters,
      ...productParameters,
    },
    responses: {
      BadRequest: { description: 'The request is invalid', content: errorContent },
      Unauthorized: { description: 'Missing or invalid credentials', content: errorContent },
      Forbidden: { description: 'The user is not allowed to do this', content: errorContent },
      NotFound: { description: 'The resource does not exist', content: errorContent },
      Conflict: {
        description: 'The request conflicts with existing data',
        content: errorContent,
      },
      TooManyRequests: { description: 'Too many requests', content: errorContent },
      ServerError: { description: 'Unexpected server error', content: errorContent },
    },
    schemas: {
      ...authSchemas,
      ...blogSchemas,
      ...categorySchemas,
      ...productSchemas,
      PageMeta: {
        type: 'object',
        required: ['page', 'limit', 'total'],
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          total: { type: 'integer', example: 1 },
        },
      },
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['message'],
            properties: {
              message: { type: 'string' },
              details: {
                type: 'array',
                description: 'Only present on validation errors',
                items: {
                  type: 'object',
                  required: ['field', 'message'],
                  properties: {
                    field: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
