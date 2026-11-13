const dataContent = (name: string) => ({
  'application/json': {
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: `#/components/schemas/${name}` } },
    },
  },
});

const pageContent = (name: string) => ({
  'application/json': {
    schema: {
      type: 'object',
      required: ['data', 'meta'],
      properties: {
        data: { type: 'array', items: { $ref: `#/components/schemas/${name}` } },
        meta: { $ref: '#/components/schemas/PageMeta' },
      },
    },
  },
});

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
const bannerId = { $ref: '#/components/parameters/BannerId' };

const tags = ['Banners'];
const security = [{ bearerAuth: [] }];

export const bannerPaths = {
  '/api/banners': {
    get: {
      tags,
      summary: 'List the banners the storefront shows',
      description:
        'Returns active banners whose dates include now, in position order. Show mobileImageUrl on phones when it is set, and imageUrl otherwise.',
      responses: {
        200: { description: 'The current banners', content: pageContent('Banner') },
        500: serverError,
      },
    },
    post: {
      tags,
      summary: 'Add a banner (needs banners.manage)',
      description:
        'Upload the images through /api/assets first, then send their ids. A store can have at most 15 banners, counting inactive ones.',
      security,
      requestBody: jsonBody('CreateBanner'),
      responses: {
        201: { description: 'The created banner', content: dataContent('Banner') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/banners/admin': {
    get: {
      tags,
      summary: 'List every banner, including inactive and scheduled ones (needs banners.manage)',
      description:
        'meta.maxBanners is the most a store can have, counting inactive ones, so the admin app can warn before the limit.',
      security,
      responses: {
        200: {
          description: 'All banners',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data', 'meta'],
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Banner' } },
                  meta: {
                    allOf: [
                      { $ref: '#/components/schemas/PageMeta' },
                      {
                        type: 'object',
                        required: ['maxBanners'],
                        properties: { maxBanners: { type: 'integer', example: 15 } },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  },
  '/api/banners/{id}': {
    patch: {
      tags,
      summary: 'Update a banner (needs banners.manage)',
      description: 'Set mobileAssetId to null to use the default image on phones.',
      security,
      parameters: [bannerId],
      requestBody: jsonBody('UpdateBanner'),
      responses: {
        200: { description: 'The updated banner', content: dataContent('Banner') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
    delete: {
      tags,
      summary: 'Delete a banner (needs banners.manage)',
      description: 'Its images stay in /api/assets.',
      security,
      parameters: [bannerId],
      responses: {
        204: { description: 'The banner was deleted' },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
  },
};

export const bannerParameters = {
  BannerId: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
};

const assetId = { type: 'string', format: 'uuid', description: 'The default image' };
const mobileAssetId = {
  type: ['string', 'null'],
  format: 'uuid',
  description: 'Shown on phones instead of the default image',
};
const altText = {
  type: 'string',
  minLength: 1,
  maxLength: 200,
  description: 'Describes both images',
  example: 'Holiday sale, up to 30% off',
};
const title = { type: ['string', 'null'], minLength: 1, maxLength: 100, example: 'Holiday Sale' };
const subtitle = {
  type: ['string', 'null'],
  minLength: 1,
  maxLength: 200,
  example: 'Up to 30% off',
};
const linkUrl = {
  type: ['string', 'null'],
  maxLength: 500,
  pattern: '^(/(?![/\\\\])|https://)\\S*$',
  description: 'A storefront path starting with /, or an https:// link',
  example: '/categories',
};
const position = {
  type: 'integer',
  minimum: 0,
  maximum: 1000,
  description: 'Lower comes first',
};
const date = {
  type: ['string', 'null'],
  format: 'date-time',
  description: 'Null means no limit',
};

export const bannerSchemas = {
  Banner: {
    type: 'object',
    required: [
      'id',
      'assetId',
      'mobileAssetId',
      'imageUrl',
      'mobileImageUrl',
      'altText',
      'title',
      'subtitle',
      'linkUrl',
      'position',
      'isActive',
      'startsAt',
      'endsAt',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      assetId,
      mobileAssetId,
      imageUrl: { type: 'string', format: 'uri' },
      mobileImageUrl: { type: ['string', 'null'], format: 'uri' },
      altText,
      title,
      subtitle,
      linkUrl,
      position,
      isActive: { type: 'boolean' },
      startsAt: date,
      endsAt: date,
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateBanner: {
    type: 'object',
    required: ['assetId', 'altText'],
    additionalProperties: false,
    properties: {
      assetId,
      mobileAssetId,
      altText,
      title,
      subtitle,
      linkUrl,
      position: { ...position, default: 0 },
      isActive: { type: 'boolean', default: true },
      startsAt: date,
      endsAt: { ...date, description: 'Must be after startsAt. Null means no limit.' },
    },
  },
  UpdateBanner: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: {
      assetId,
      mobileAssetId,
      altText,
      title,
      subtitle,
      linkUrl,
      position,
      isActive: { type: 'boolean' },
      startsAt: date,
      endsAt: date,
    },
  },
};
