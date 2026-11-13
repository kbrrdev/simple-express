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
const serverError = { $ref: '#/components/responses/ServerError' };
const promotionId = { $ref: '#/components/parameters/PromotionId' };

const tags = ['Promotions'];
const security = [{ bearerAuth: [] }];

export const promotionPaths = {
  '/api/promotions': {
    get: {
      tags,
      summary: 'List every promotion (needs promotions.manage)',
      description:
        'Buy X get Y and bundle offers. Shoppers see them as badges on products and as discounts in the order preview, so these routes are for admins only.',
      security,
      responses: {
        200: { description: 'All promotions, newest first', content: pageContent('Promotion') },
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
    post: {
      tags,
      summary: 'Add a promotion (needs promotions.manage)',
      description:
        'Items on sale are left out. Each cart line gets at most one promotion, the largest discount first.',
      security,
      requestBody: jsonBody('CreatePromotion'),
      responses: {
        201: { description: 'The created promotion', content: dataContent('Promotion') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  },
  '/api/promotions/{id}': {
    get: {
      tags,
      summary: 'Get a promotion (needs promotions.manage)',
      security,
      parameters: [promotionId],
      responses: {
        200: { description: 'The promotion', content: dataContent('Promotion') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
    patch: {
      tags,
      summary: 'Update a promotion (needs promotions.manage)',
      description:
        'productIds and categoryIds replace the whole list when sent. Orders already placed keep their discounts.',
      security,
      parameters: [promotionId],
      requestBody: jsonBody('UpdatePromotion'),
      responses: {
        200: { description: 'The updated promotion', content: dataContent('Promotion') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
    delete: {
      tags,
      summary: 'Delete a promotion (needs promotions.manage)',
      description: 'Orders already placed keep their discounts.',
      security,
      parameters: [promotionId],
      responses: {
        204: { description: 'The promotion was deleted' },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
  },
};

export const promotionParameters = {
  PromotionId: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
};

const nullableInteger = (description: string, maximum: number) => ({
  type: ['integer', 'null'],
  minimum: 1,
  maximum,
  description,
});
const date = { type: ['string', 'null'], format: 'date-time', description: 'Null means no limit' };
const ids = { type: 'array', items: { type: 'string', format: 'uuid' }, uniqueItems: true };

const promotionFields = {
  name: { type: 'string', minLength: 1, maxLength: 100, example: 'Buy 2 tees, get 1 free' },
  type: { type: 'string', enum: ['buy_x_get_y', 'bundle'] },
  buyQuantity: nullableInteger('Buy X get Y only. Units to buy in each set.', 100),
  getQuantity: nullableInteger('Buy X get Y only. Units discounted in each set.', 100),
  getPercentOff: nullableInteger(
    'Buy X get Y only. Taken off the cheapest units in the cart. 100 makes them free.',
    100,
  ),
  discountType: {
    type: ['string', 'null'],
    enum: ['percent', 'fixed', null],
    description: 'Bundles only',
  },
  discountValue: nullableInteger(
    'Bundles only. 1 to 100 for percent, or cents off each complete set for fixed.',
    2147483647,
  ),
  startsAt: date,
  endsAt: date,
  isActive: { type: 'boolean' },
  productIds: {
    ...ids,
    description: 'Buy X get Y: any number. Bundles: the 2 to 10 products in each set.',
  },
  categoryIds: {
    ...ids,
    description: 'Buy X get Y only. Each category covers its subcategories.',
  },
};

export const promotionSchemas = {
  Promotion: {
    type: 'object',
    required: ['id', ...Object.keys(promotionFields), 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      ...promotionFields,
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreatePromotion: {
    type: 'object',
    required: ['name', 'type'],
    additionalProperties: false,
    properties: { ...promotionFields, isActive: { type: 'boolean', default: true } },
  },
  UpdatePromotion: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: promotionFields,
  },
};
