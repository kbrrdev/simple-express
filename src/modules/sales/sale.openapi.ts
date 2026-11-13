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
const saleId = { $ref: '#/components/parameters/SaleId' };

const tags = ['Sales'];
const security = [{ bearerAuth: [] }];

export const salePaths = {
  '/api/sales': {
    get: {
      tags,
      summary: 'List every sale (needs promotions.manage)',
      description:
        'Shoppers see sales through the prices on products, the cart, and orders, so these routes are for admins only.',
      security,
      responses: {
        200: { description: 'All sales, newest first', content: pageContent('Sale') },
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
    post: {
      tags,
      summary: 'Add a sale (needs promotions.manage)',
      description:
        'A flash sale is a sale with short dates, and optionally a stockCap. When a product is in more than one sale, shoppers get the lowest price.',
      security,
      requestBody: jsonBody('CreateSale'),
      responses: {
        201: { description: 'The created sale', content: dataContent('Sale') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  },
  '/api/sales/{id}': {
    get: {
      tags,
      summary: 'Get a sale (needs promotions.manage)',
      security,
      parameters: [saleId],
      responses: {
        200: { description: 'The sale', content: dataContent('Sale') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
    patch: {
      tags,
      summary: 'Update a sale (needs promotions.manage)',
      description:
        'productIds and categoryIds replace the whole list when sent. Orders already placed keep their prices.',
      security,
      parameters: [saleId],
      requestBody: jsonBody('UpdateSale'),
      responses: {
        200: { description: 'The updated sale', content: dataContent('Sale') },
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
      summary: 'Delete a sale (needs promotions.manage)',
      description: 'Orders already placed keep their prices.',
      security,
      parameters: [saleId],
      responses: {
        204: { description: 'The sale was deleted' },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
  },
};

export const saleParameters = {
  SaleId: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
};

const name = { type: 'string', minLength: 1, maxLength: 100, example: 'Payday Sale' };
const discountType = {
  type: 'string',
  enum: ['percent', 'fixed'],
  description: 'percent takes discountValue percent off, and fixed takes discountValue cents off',
};
const discountValue = {
  type: 'integer',
  minimum: 1,
  description: 'From 1 to 90 for percent, or an amount in cents for fixed',
  example: 20,
};
const date = { type: ['string', 'null'], format: 'date-time', description: 'Null means no limit' };
const stockCap = {
  type: ['integer', 'null'],
  minimum: 1,
  description:
    'Units that can sell at the sale price, across all its products. Prices go back to normal once they are sold.',
  example: 50,
};
const ids = { type: 'array', items: { type: 'string', format: 'uuid' }, uniqueItems: true };

export const saleSchemas = {
  Sale: {
    type: 'object',
    required: [
      'id',
      'name',
      'discountType',
      'discountValue',
      'startsAt',
      'endsAt',
      'isActive',
      'stockCap',
      'soldCount',
      'productIds',
      'categoryIds',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name,
      discountType,
      discountValue,
      startsAt: date,
      endsAt: date,
      isActive: { type: 'boolean' },
      stockCap,
      soldCount: {
        type: 'integer',
        description: 'Units sold at the sale price. Only counted when there is a stockCap.',
      },
      productIds: ids,
      categoryIds: { ...ids, description: 'Each category covers its subcategories' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateSale: {
    type: 'object',
    required: ['name', 'discountType', 'discountValue'],
    additionalProperties: false,
    description: 'Needs at least one product or category.',
    properties: {
      name,
      discountType,
      discountValue,
      startsAt: date,
      endsAt: { ...date, description: 'Must be after startsAt. Null means no limit.' },
      isActive: { type: 'boolean', default: true },
      stockCap,
      productIds: ids,
      categoryIds: ids,
    },
  },
  UpdateSale: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: {
      name,
      discountType,
      discountValue,
      startsAt: date,
      endsAt: date,
      isActive: { type: 'boolean' },
      stockCap,
      productIds: ids,
      categoryIds: ids,
    },
  },
};
