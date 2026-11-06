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

const statuses = [
  'awaiting_payment',
  'pending',
  'confirmed',
  'shipped',
  'delivered',
  'returned',
  'cancelled',
];

const listParameters = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
  { name: 'status', in: 'query', schema: { type: 'string', enum: statuses } },
];

const badRequest = { $ref: '#/components/responses/BadRequest' };
const unauthorized = { $ref: '#/components/responses/Unauthorized' };
const forbidden = { $ref: '#/components/responses/Forbidden' };
const notFound = { $ref: '#/components/responses/NotFound' };
const conflict = { $ref: '#/components/responses/Conflict' };
const serverError = { $ref: '#/components/responses/ServerError' };
const orderId = { $ref: '#/components/parameters/OrderId' };

const tags = ['Orders'];
const security = [{ bearerAuth: [] }];

export const orderPaths = {
  '/api/orders/preview': {
    post: {
      tags,
      summary: 'Price items with shipping and tax',
      description:
        'Shows the final total before checkout. Send the returned `totalCents` to checkout as `expectedTotalCents`.',
      requestBody: jsonBody('CartItems'),
      responses: {
        200: { description: 'The priced items', content: dataContent('OrderPreview') },
        400: badRequest,
        500: serverError,
      },
    },
  },
  '/api/orders': {
    get: {
      tags,
      summary: 'List the current user’s orders, newest first',
      security,
      parameters: listParameters,
      responses: {
        200: { description: 'A page of orders', content: pageContent('Order') },
        400: badRequest,
        401: unauthorized,
        500: serverError,
      },
    },
    post: {
      tags,
      summary: 'Check out the current cart',
      description:
        'Reduces stock, saves the order, and empties the cart in one transaction. Repeating a request with the same `idempotencyKey` returns the original order with 200. Fails with 409 if the cart is empty, an item is unavailable or short of stock, or the total differs from `expectedTotalCents`.',
      security,
      requestBody: jsonBody('CreateOrder'),
      responses: {
        200: {
          description: 'The original order, for a repeated request',
          content: dataContent('Order'),
        },
        201: {
          description: 'The created order',
          headers: {
            Location: { description: 'URL of the order', schema: { type: 'string' } },
          },
          content: dataContent('Order'),
        },
        400: badRequest,
        401: unauthorized,
        404: notFound,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/orders/admin': {
    get: {
      tags,
      summary: 'List all orders (admin)',
      security,
      parameters: listParameters,
      responses: {
        200: { description: 'A page of orders', content: pageContent('AdminOrder') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  },
  '/api/orders/admin/{id}': {
    get: {
      tags,
      summary: 'Get any order (admin)',
      security,
      parameters: [orderId],
      responses: {
        200: { description: 'The order', content: dataContent('AdminOrder') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
  },
  '/api/orders/admin/{id}/status': {
    patch: {
      tags,
      summary: 'Move an order to its next status (admin)',
      description:
        'Allowed moves: pending to confirmed or cancelled, confirmed to shipped or cancelled, and shipped to delivered or returned. Cancelling returns stock. Returning does not, as the item may be damaged. Delivering a COD order marks it paid.',
      security,
      parameters: [orderId],
      requestBody: jsonBody('UpdateOrderStatus'),
      responses: {
        200: { description: 'The updated order', content: dataContent('AdminOrder') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/orders/{id}': {
    get: {
      tags,
      summary: 'Get one of the current user’s orders',
      security,
      parameters: [orderId],
      responses: {
        200: { description: 'The order', content: dataContent('Order') },
        400: badRequest,
        401: unauthorized,
        404: notFound,
        500: serverError,
      },
    },
  },
  '/api/orders/{id}/cancel': {
    post: {
      tags,
      summary: 'Cancel a pending order',
      description: 'Returns the stock. Fails with 409 once the order has been confirmed.',
      security,
      parameters: [orderId],
      responses: {
        200: { description: 'The cancelled order', content: dataContent('Order') },
        400: badRequest,
        401: unauthorized,
        404: notFound,
        409: conflict,
        500: serverError,
      },
    },
  },
};

export const orderParameters = {
  OrderId: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
};

const nullableString = { type: ['string', 'null'] };

const totals = {
  subtotalCents: { type: 'integer', example: 112000 },
  shippingCents: { type: 'integer', example: 10000 },
  vatableCents: {
    type: 'integer',
    description: 'The total before tax',
    example: 108929,
  },
  taxCents: { type: 'integer', example: 13071 },
  totalCents: { type: 'integer', example: 122000 },
  taxRatePercent: { type: 'number', example: 12 },
  pricesIncludeTax: { type: 'boolean' },
};

const orderRequired = [
  'id',
  'orderNumber',
  'status',
  'paymentMethod',
  'paymentStatus',
  'subtotalCents',
  'shippingCents',
  'vatableCents',
  'taxCents',
  'totalCents',
  'taxRatePercent',
  'pricesIncludeTax',
  'shippingAddress',
  'items',
  'createdAt',
  'updatedAt',
];

const orderProperties = {
  id: { type: 'string', format: 'uuid' },
  orderNumber: { type: 'string', example: 'ORD-000123' },
  status: { type: 'string', enum: statuses },
  paymentMethod: { type: 'string', enum: ['cod', 'gcash', 'bank_transfer'] },
  paymentStatus: { type: 'string', enum: ['unpaid', 'submitted', 'paid', 'refunded'] },
  ...totals,
  shippingAddress: {
    type: 'object',
    required: [
      'recipientName',
      'phone',
      'line1',
      'line2',
      'barangay',
      'city',
      'province',
      'postalCode',
    ],
    properties: {
      recipientName: { type: 'string' },
      phone: { type: 'string' },
      line1: { type: 'string' },
      line2: { type: 'string' },
      barangay: { type: 'string' },
      city: { type: 'string' },
      province: { type: 'string' },
      postalCode: { type: 'string' },
    },
  },
  items: { type: 'array', items: { $ref: '#/components/schemas/OrderItem' } },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};

export const orderSchemas = {
  OrderPreview: {
    type: 'object',
    required: [
      'items',
      'subtotalCents',
      'shippingCents',
      'vatableCents',
      'taxCents',
      'totalCents',
      'taxRatePercent',
      'pricesIncludeTax',
    ],
    properties: {
      items: { type: 'array', items: { $ref: '#/components/schemas/CartItem' } },
      ...totals,
    },
  },
  OrderItem: {
    type: 'object',
    required: [
      'id',
      'variantId',
      'productName',
      'option1Name',
      'option1Value',
      'option2Name',
      'option2Value',
      'unitPriceCents',
      'quantity',
      'taxCents',
      'lineTotalCents',
      'imageUrl',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      variantId: { type: 'string', format: 'uuid' },
      productName: { type: 'string', example: 'Classic T-Shirt' },
      option1Name: nullableString,
      option1Value: nullableString,
      option2Name: nullableString,
      option2Value: nullableString,
      unitPriceCents: { type: 'integer', example: 56000 },
      quantity: { type: 'integer', example: 2 },
      taxCents: { type: 'integer', example: 12000 },
      lineTotalCents: { type: 'integer', example: 112000 },
      imageUrl: { type: ['string', 'null'], format: 'uri' },
    },
  },
  Order: {
    type: 'object',
    required: orderRequired,
    properties: orderProperties,
  },
  AdminOrder: {
    type: 'object',
    required: [...orderRequired, 'userId', 'customerEmail'],
    properties: {
      ...orderProperties,
      userId: { type: ['string', 'null'], format: 'uuid' },
      customerEmail: { type: ['string', 'null'], format: 'email' },
    },
  },
  CreateOrder: {
    type: 'object',
    required: ['addressId', 'paymentMethod', 'expectedTotalCents', 'idempotencyKey'],
    additionalProperties: false,
    properties: {
      addressId: { type: 'string', format: 'uuid' },
      paymentMethod: { type: 'string', enum: ['cod'] },
      expectedTotalCents: {
        type: 'integer',
        minimum: 0,
        description: 'The total shown to the customer, from the preview',
      },
      idempotencyKey: {
        type: 'string',
        format: 'uuid',
        description: 'A new value per checkout, reused when retrying it',
      },
    },
  },
  UpdateOrderStatus: {
    type: 'object',
    required: ['status'],
    additionalProperties: false,
    properties: {
      status: {
        type: 'string',
        enum: ['confirmed', 'shipped', 'delivered', 'returned', 'cancelled'],
      },
    },
  },
};
