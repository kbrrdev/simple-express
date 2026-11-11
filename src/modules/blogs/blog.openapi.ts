const blogContent = {
  'application/json': {
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: '#/components/schemas/Blog' } },
    },
  },
};

const badRequest = { $ref: '#/components/responses/BadRequest' };
const unauthorized = { $ref: '#/components/responses/Unauthorized' };
const forbidden = { $ref: '#/components/responses/Forbidden' };
const notFound = { $ref: '#/components/responses/NotFound' };
const serverError = { $ref: '#/components/responses/ServerError' };
const blogId = { $ref: '#/components/parameters/BlogId' };

const tags = ['Blogs'];
const security = [{ bearerAuth: [] }];

export const blogPaths = {
  '/api/blogs': {
    get: {
      tags,
      summary: 'List published blogs, newest first',
      parameters: [
        {
          name: 'page',
          in: 'query',
          schema: { type: 'integer', minimum: 1, default: 1 },
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        200: {
          description: 'A page of blogs',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data', 'meta'],
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Blog' } },
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
      summary: 'Create a blog (needs blogs.manage)',
      security,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CreateBlog' } },
        },
      },
      responses: {
        201: {
          description: 'The created blog',
          headers: {
            Location: {
              description: 'URL of the created blog',
              schema: { type: 'string' },
            },
          },
          content: blogContent,
        },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  },
  '/api/blogs/admin': {
    get: {
      tags,
      summary: 'List all blogs, including drafts (needs blogs.manage)',
      security,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        { name: 'published', in: 'query', schema: { type: 'boolean' } },
      ],
      responses: {
        200: {
          description: 'A page of blogs',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data', 'meta'],
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Blog' } },
                  meta: { $ref: '#/components/schemas/PageMeta' },
                },
              },
            },
          },
        },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  },
  '/api/blogs/admin/{id}': {
    get: {
      tags,
      summary: 'Get any blog, including drafts (needs blogs.manage)',
      security,
      parameters: [blogId],
      responses: {
        200: { description: 'The blog', content: blogContent },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
  },
  '/api/blogs/{id}': {
    get: {
      tags,
      summary: 'Get a published blog',
      parameters: [blogId],
      responses: {
        200: { description: 'The blog', content: blogContent },
        400: badRequest,
        404: notFound,
        500: serverError,
      },
    },
    patch: {
      tags,
      summary: 'Update a blog (needs blogs.manage)',
      security,
      parameters: [blogId],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/UpdateBlog' } },
        },
      },
      responses: {
        200: { description: 'The updated blog', content: blogContent },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
    delete: {
      tags,
      summary: 'Delete a blog (needs blogs.manage)',
      security,
      parameters: [blogId],
      responses: {
        204: { description: 'The blog was deleted' },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
  },
};

export const blogParameters = {
  BlogId: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
};

export const blogSchemas = {
  Blog: {
    type: 'object',
    required: [
      'id',
      'title',
      'content',
      'author',
      'published',
      'coverAssetId',
      'coverImageUrl',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string', maxLength: 255, example: 'Hello' },
      content: { type: 'string', example: 'First post' },
      author: { type: 'string', maxLength: 100, example: 'Jane' },
      published: { type: 'boolean' },
      coverAssetId: { type: ['string', 'null'], format: 'uuid' },
      coverImageUrl: { type: ['string', 'null'], format: 'uri' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateBlog: {
    type: 'object',
    required: ['title', 'content', 'author'],
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 255, example: 'Hello' },
      content: { type: 'string', minLength: 1, example: 'First post' },
      author: { type: 'string', minLength: 1, maxLength: 100, example: 'Jane' },
      published: { type: 'boolean', default: false, example: true },
      coverAssetId: { type: ['string', 'null'], format: 'uuid' },
    },
  },
  UpdateBlog: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 255, example: 'Updated title' },
      content: { type: 'string', minLength: 1 },
      author: { type: 'string', minLength: 1, maxLength: 100 },
      published: { type: 'boolean' },
      coverAssetId: { type: ['string', 'null'], format: 'uuid' },
    },
  },
};
