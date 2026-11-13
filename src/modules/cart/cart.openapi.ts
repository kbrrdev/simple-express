const jsonBody = (name: string) => ({
  required: true,
  content: {
    'application/json': { schema: { $ref: `#/components/schemas/${name}` } },
  },
});

const dataContent = (name: string) => ({
  'application/json': {
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: `#/components/schemas/${name}` } },
    },
  },
});

const badRequest = { $ref: '#/components/responses/BadRequest' };
const unauthorized = { $ref: '#/components/responses/Unauthorized' };
const notFound = { $ref: '#/components/responses/NotFound' };
const conflict = { $ref: '#/components/responses/Conflict' };
const serverError = { $ref: '#/components/responses/ServerError' };
const variantId = { $ref: '#/components/parameters/CartVariantId' };

const tags = ['Cart'];
const security = [{ bearerAuth: [] }];

export const cartPaths = {
  '/api/cart': {
    get: {
      tags,
      summary: 'Get the current user’s cart',
      description: 'Prices are read from the variants each time, and are never stored.',
      security,
      responses: {
        200: { description: 'The cart', content: dataContent('Cart') },
        401: unauthorized,
        500: serverError,
      },
    },
    delete: {
      tags,
      summary: 'Empty the cart',
      security,
      responses: {
        204: { description: 'The cart was emptied' },
        401: unauthorized,
        500: serverError,
      },
    },
  },
  '/api/cart/preview': {
    post: {
      tags,
      summary: 'Price a guest cart without saving it',
      description: 'Variants that no longer exist are left out of the response.',
      requestBody: jsonBody('CartItems'),
      responses: {
        200: { description: 'The priced cart', content: dataContent('Cart') },
        400: badRequest,
        500: serverError,
      },
    },
  },
  '/api/cart/merge': {
    post: {
      tags,
      summary: 'Move a guest cart into the current user’s cart',
      description:
        'An item in both carts keeps the higher quantity, so a retried request changes nothing. Quantities are reduced to the available stock, and unavailable variants are skipped. Both are listed in `adjustments`.',
      security,
      requestBody: jsonBody('CartItems'),
      responses: {
        200: { description: 'The merged cart', content: dataContent('MergedCart') },
        400: badRequest,
        401: unauthorized,
        500: serverError,
      },
    },
  },
  '/api/cart/items': {
    post: {
      tags,
      summary: 'Add a variant to the cart',
      description: 'If the variant is already in the cart, the quantities are added together.',
      security,
      requestBody: jsonBody('AddCartItem'),
      responses: {
        200: { description: 'The updated cart', content: dataContent('Cart') },
        400: badRequest,
        401: unauthorized,
        404: notFound,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/cart/items/{variantId}': {
    patch: {
      tags,
      summary: 'Set the quantity of an item',
      security,
      parameters: [variantId],
      requestBody: jsonBody('UpdateCartItem'),
      responses: {
        200: { description: 'The updated cart', content: dataContent('Cart') },
        400: badRequest,
        401: unauthorized,
        404: notFound,
        409: conflict,
        500: serverError,
      },
    },
    delete: {
      tags,
      summary: 'Remove an item',
      security,
      parameters: [variantId],
      responses: {
        204: { description: 'The item was removed' },
        400: badRequest,
        401: unauthorized,
        404: notFound,
        500: serverError,
      },
    },
  },
};

export const cartParameters = {
  CartVariantId: {
    name: 'variantId',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
};

const quantity = { type: 'integer', minimum: 1, maximum: 99, example: 2 };
const nullableString = { type: ['string', 'null'] };

const cartProperties = {
  items: { type: 'array', items: { $ref: '#/components/schemas/CartItem' } },
  subtotalCents: {
    type: 'integer',
    description: 'Total of the available items, in cents',
    example: 3998,
  },
};

export const cartSchemas = {
  CartItem: {
    type: 'object',
    required: [
      'variantId',
      'productId',
      'productName',
      'imageUrl',
      'option1Name',
      'option1Value',
      'option2Name',
      'option2Value',
      'unitPriceCents',
      'compareAtPriceCents',
      'saleEndsAt',
      'quantity',
      'lineTotalCents',
      'stock',
      'available',
    ],
    properties: {
      variantId: { type: 'string', format: 'uuid' },
      productId: { type: 'string', format: 'uuid' },
      productName: { type: 'string', example: 'Classic T-Shirt' },
      imageUrl: {
        type: ['string', 'null'],
        format: 'uri',
        description: "The variant's image, or the product's first image",
      },
      option1Name: { ...nullableString, example: 'Size' },
      option1Value: { ...nullableString, example: 'M' },
      option2Name: { ...nullableString, example: 'Color' },
      option2Value: { ...nullableString, example: 'Red' },
      unitPriceCents: { type: 'integer', description: 'Includes any sale', example: 1999 },
      compareAtPriceCents: {
        type: ['integer', 'null'],
        description:
          'The price before a sale, for showing it struck through. Null when nothing is on sale.',
        example: 2499,
      },
      saleEndsAt: {
        type: ['string', 'null'],
        format: 'date-time',
        description: 'When the sale price ends, for a countdown. Null when it has no end.',
      },
      quantity,
      lineTotalCents: { type: 'integer', example: 3998 },
      stock: {
        type: 'integer',
        description: 'Current stock. It can be lower than the quantity, as carts reserve nothing.',
        example: 12,
      },
      available: {
        type: 'boolean',
        description: 'False when the product or variant was deactivated',
      },
    },
  },
  Cart: {
    type: 'object',
    required: ['items', 'subtotalCents'],
    properties: cartProperties,
  },
  MergedCart: {
    type: 'object',
    required: ['items', 'subtotalCents', 'adjustments'],
    properties: {
      ...cartProperties,
      adjustments: {
        type: 'array',
        description: 'Guest items that were reduced or skipped',
        items: {
          type: 'object',
          required: ['variantId', 'requestedQuantity', 'addedQuantity'],
          properties: {
            variantId: { type: 'string', format: 'uuid' },
            requestedQuantity: { type: 'integer', example: 5 },
            addedQuantity: { type: 'integer', description: 'Zero when skipped', example: 3 },
          },
        },
      },
    },
  },
  AddCartItem: {
    type: 'object',
    required: ['variantId'],
    additionalProperties: false,
    properties: {
      variantId: { type: 'string', format: 'uuid' },
      quantity: { ...quantity, default: 1 },
    },
  },
  UpdateCartItem: {
    type: 'object',
    required: ['quantity'],
    additionalProperties: false,
    properties: { quantity },
  },
  CartItems: {
    type: 'object',
    required: ['items'],
    additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        maxItems: 100,
        description: 'Each variant can appear once',
        items: {
          type: 'object',
          required: ['variantId', 'quantity'],
          additionalProperties: false,
          properties: {
            variantId: { type: 'string', format: 'uuid' },
            quantity,
          },
        },
      },
    },
  },
};
