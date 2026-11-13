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
const couponId = { $ref: '#/components/parameters/CouponId' };

const tags = ['Coupons'];
const security = [{ bearerAuth: [] }];

export const couponPaths = {
  '/api/coupons': {
    get: {
      tags,
      summary: 'List every coupon with its usage (needs promotions.manage)',
      description:
        'Shoppers use coupons through couponCode on the order preview and checkout, so these routes are for admins only.',
      security,
      responses: {
        200: { description: 'All coupons, newest first', content: pageContent('Coupon') },
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
    post: {
      tags,
      summary: 'Add a coupon (needs promotions.manage)',
      security,
      requestBody: jsonBody('CreateCoupon'),
      responses: {
        201: { description: 'The created coupon', content: dataContent('Coupon') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/coupons/{id}': {
    get: {
      tags,
      summary: 'Get a coupon (needs promotions.manage)',
      security,
      parameters: [couponId],
      responses: {
        200: { description: 'The coupon', content: dataContent('Coupon') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
    patch: {
      tags,
      summary: 'Update a coupon (needs promotions.manage)',
      description: 'Orders already placed keep their discount.',
      security,
      parameters: [couponId],
      requestBody: jsonBody('UpdateCoupon'),
      responses: {
        200: { description: 'The updated coupon', content: dataContent('Coupon') },
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
      summary: 'Delete a coupon (needs promotions.manage)',
      description: 'Fails with 409 once orders use it. Set isActive to false instead.',
      security,
      parameters: [couponId],
      responses: {
        204: { description: 'The coupon was deleted' },
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

export const couponParameters = {
  CouponId: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
};

const code = {
  type: 'string',
  pattern: '^[A-Za-z0-9_-]{3,32}$',
  description: 'Saved in capitals, and matched in any case',
  example: 'WELCOME10',
};
const discountType = {
  type: 'string',
  enum: ['percent', 'fixed', 'free_shipping'],
  description: 'percent and fixed come off eligible items. free_shipping waives shipping.',
};
const nullableCents = (description: string) => ({
  type: ['integer', 'null'],
  minimum: 1,
  description,
});
const nullableCount = (description: string) => ({
  type: ['integer', 'null'],
  minimum: 1,
  description,
});
const date = { type: ['string', 'null'], format: 'date-time', description: 'Null means no limit' };

const couponFields = {
  code,
  discountType,
  discountValue: nullableCents(
    'From 1 to 100 for percent, or cents for fixed. Ignored for free_shipping.',
  ),
  maxDiscountCents: nullableCents('The most a percentage coupon takes off'),
  minSubtotalCents: nullableCents('The least to spend on eligible items'),
  startsAt: date,
  endsAt: date,
  usageLimit: nullableCount('Total uses across all shoppers. Null means no limit.'),
  perCustomerLimit: nullableCount(
    'Uses per account or guest email. Null means no limit. Guests are counted by email, which they can change.',
  ),
  allowSaleItems: {
    type: 'boolean',
    description: 'Whether items already on sale count towards the coupon',
  },
  allowGuests: { type: 'boolean' },
  isActive: { type: 'boolean' },
};

export const couponSchemas = {
  Coupon: {
    type: 'object',
    required: [
      'id',
      ...Object.keys(couponFields),
      'usedCount',
      'discountGivenCents',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      ...couponFields,
      usedCount: { type: 'integer', description: 'Orders that used it, apart from cancelled ones' },
      discountGivenCents: {
        type: 'integer',
        description: 'What shoppers saved with it, including waived shipping',
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateCoupon: {
    type: 'object',
    required: ['code', 'discountType'],
    additionalProperties: false,
    properties: {
      ...couponFields,
      perCustomerLimit: { ...couponFields.perCustomerLimit, default: 1 },
      allowSaleItems: { ...couponFields.allowSaleItems, default: false },
      allowGuests: { type: 'boolean', default: true },
      isActive: { type: 'boolean', default: true },
    },
  },
  UpdateCoupon: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: couponFields,
  },
};
