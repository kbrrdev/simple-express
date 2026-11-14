const dataContent = (name: string) => ({
  'application/json': {
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: `#/components/schemas/${name}` } },
    },
  },
});

const listContent = {
  'application/json': {
    schema: {
      type: 'object',
      required: ['data', 'meta'],
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/ContentPageSummary' } },
        meta: { $ref: '#/components/schemas/PageMeta' },
      },
    },
  },
};

const jsonBody = (name: string) => ({
  required: true,
  content: {
    'application/json': { schema: { $ref: `#/components/schemas/${name}` } },
  },
});

const badRequest = { $ref: '#/components/responses/BadRequest' };
const unauthorized = { $ref: '#/components/responses/Unauthorized' };
const forbidden = { $ref: '#/components/responses/Forbidden' };
const notFound = { $ref: '#/components/responses/NotFound' };
const conflict = { $ref: '#/components/responses/Conflict' };
const serverError = { $ref: '#/components/responses/ServerError' };
const pageId = { $ref: '#/components/parameters/ContentPageId' };

const tags = ['Pages'];
const security = [{ bearerAuth: [] }];

export const pagePaths = {
  '/api/pages': {
    get: {
      tags,
      summary: 'List published pages, without their content',
      description: 'For footer links, in title order.',
      responses: {
        200: { description: 'The published pages', content: listContent },
        500: serverError,
      },
    },
    post: {
      tags,
      summary: 'Create a page, such as terms or privacy (needs pages.manage)',
      security,
      requestBody: jsonBody('CreateContentPage'),
      responses: {
        201: { description: 'The created page', content: dataContent('ContentPage') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/pages/admin': {
    get: {
      tags,
      summary: 'List every page, including drafts (needs pages.manage)',
      security,
      responses: {
        200: { description: 'All pages', content: listContent },
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  },
  '/api/pages/admin/{id}': {
    get: {
      tags,
      summary: 'Get any page by id, including drafts (needs pages.manage)',
      security,
      parameters: [pageId],
      responses: {
        200: { description: 'The page', content: dataContent('ContentPage') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
    patch: {
      tags,
      summary: 'Update a page (needs pages.manage)',
      security,
      parameters: [pageId],
      requestBody: jsonBody('UpdateContentPage'),
      responses: {
        200: { description: 'The updated page', content: dataContent('ContentPage') },
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
      summary: 'Delete a page (needs pages.manage)',
      security,
      parameters: [pageId],
      responses: {
        204: { description: 'The page was deleted' },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
  },
  '/api/pages/{slug}': {
    get: {
      tags,
      summary: 'Get a published page by slug',
      description: 'Drafts return 404. Show updatedAt as the last updated date.',
      parameters: [
        {
          name: 'slug',
          in: 'path',
          required: true,
          schema: { type: 'string', example: 'terms' },
        },
      ],
      responses: {
        200: { description: 'The page', content: dataContent('ContentPage') },
        400: badRequest,
        404: notFound,
        500: serverError,
      },
    },
  },
};

export const pageParameters = {
  ContentPageId: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
};

const fields = {
  slug: {
    type: 'string',
    maxLength: 100,
    pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
    description: 'Used in the storefront URL. Cannot be "admin".',
    example: 'terms',
  },
  title: { type: 'string', maxLength: 255, example: 'Terms and Conditions' },
  content: { type: 'string', example: 'By using this store, you agree to...' },
  published: { type: 'boolean', description: 'Drafts are hidden from the storefront' },
};

const timestamps = {
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};

export const pageSchemas = {
  ContentPage: {
    type: 'object',
    required: ['id', 'slug', 'title', 'content', 'published', 'createdAt', 'updatedAt'],
    properties: { id: { type: 'string', format: 'uuid' }, ...fields, ...timestamps },
  },
  ContentPageSummary: {
    type: 'object',
    required: ['id', 'slug', 'title', 'published', 'updatedAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      slug: fields.slug,
      title: fields.title,
      published: fields.published,
      updatedAt: timestamps.updatedAt,
    },
  },
  CreateContentPage: {
    type: 'object',
    required: ['slug', 'title', 'content'],
    properties: fields,
  },
  UpdateContentPage: {
    type: 'object',
    minProperties: 1,
    properties: fields,
  },
};
