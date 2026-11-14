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

const tags = ['Orders'];
const security = [{ bearerAuth: [] }];

const badRequest = { $ref: '#/components/responses/BadRequest' };
const unauthorized = { $ref: '#/components/responses/Unauthorized' };
const forbidden = { $ref: '#/components/responses/Forbidden' };
const notFound = { $ref: '#/components/responses/NotFound' };
const conflict = { $ref: '#/components/responses/Conflict' };
const serverError = { $ref: '#/components/responses/ServerError' };
const orderId = { $ref: '#/components/parameters/OrderId' };
const guestToken = { $ref: '#/components/parameters/GuestToken' };
const tooManyRequests = { $ref: '#/components/responses/TooManyRequests' };

const adminPaymentAction = (summary: string, description: string) => ({
  post: {
    tags,
    summary,
    description,
    security,
    parameters: [orderId],
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
});

export const orderPaths = {
  '/api/orders/preview': {
    post: {
      tags,
      summary: 'Price items with shipping and tax',
      description:
        'Shows the final total before checkout. Send the returned `totalCents` to checkout as `expectedTotalCents`. A coupon that cannot be used does not fail the preview: it is left out, and `couponError` says why. Send a bearer token or `email`, so that once-per-customer coupons can be checked.',
      requestBody: jsonBody('PreviewOrder'),
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
  '/api/orders/guest': {
    post: {
      tags,
      summary: 'Check out as a guest',
      description:
        'Guests cannot use COD, and an order can have up to 10 items. Keep the returned `guestToken`, as it is the only way back to the order. Repeating a request with the same email and `idempotencyKey` returns the original order with 200.',
      requestBody: jsonBody('CreateGuestOrder'),
      responses: {
        200: { description: 'The original order', content: dataContent('GuestOrder') },
        201: { description: 'The created order', content: dataContent('GuestOrder') },
        400: badRequest,
        409: conflict,
        429: tooManyRequests,
        500: serverError,
      },
    },
  },
  '/api/orders/guest/{token}': {
    get: {
      tags,
      summary: 'View a guest order',
      parameters: [guestToken],
      responses: {
        200: { description: 'The order', content: dataContent('GuestOrder') },
        400: badRequest,
        404: notFound,
        500: serverError,
      },
    },
  },
  '/api/orders/guest/{token}/payment': {
    post: {
      tags,
      summary: 'Submit a payment reference for a guest order',
      parameters: [guestToken],
      requestBody: jsonBody('SubmitPayment'),
      responses: {
        200: { description: 'The updated order', content: dataContent('GuestOrder') },
        400: badRequest,
        404: notFound,
        409: conflict,
        429: tooManyRequests,
        500: serverError,
      },
    },
  },
  '/api/orders/admin': {
    get: {
      tags,
      summary: 'List all orders (needs orders.view)',
      security,
      parameters: [
        ...listParameters,
        {
          name: 'paymentStatus',
          in: 'query',
          schema: { type: 'string', enum: ['unpaid', 'submitted', 'paid', 'refunded'] },
        },
        {
          name: 'search',
          in: 'query',
          description:
            "An order number, such as ORD-000123 or 123, or part of the customer's email, the recipient's name, or the payment reference. Ignores case.",
          schema: { type: 'string', minLength: 1, maxLength: 255 },
        },
      ],
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
      summary: 'Get any order (needs orders.view)',
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
      summary: 'Move an order to its next status (needs orders.manage)',
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
  '/api/orders/admin/{id}/payment/confirm': adminPaymentAction(
    'Confirm a submitted payment (needs orders.manage)',
    'Marks the order paid and moves it to pending.',
  ),
  '/api/orders/admin/{id}/payment/reject': adminPaymentAction(
    'Reject a submitted payment (needs orders.manage)',
    'Cancels the order and returns its stock.',
  ),
  '/api/orders/admin/{id}/payment/refund': adminPaymentAction(
    'Record a refund (needs orders.refund)',
    'Records a refund made outside the system. The order must be cancelled, returned, or delivered.',
  ),
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
  '/api/orders/{id}/payment': {
    post: {
      tags,
      summary: 'Submit a payment reference',
      description: 'Used after paying a manual method. An admin then checks it.',
      security,
      parameters: [orderId],
      requestBody: jsonBody('SubmitPayment'),
      responses: {
        200: { description: 'The updated order', content: dataContent('Order') },
        400: badRequest,
        401: unauthorized,
        404: notFound,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/orders/{id}/cancel': {
    post: {
      tags,
      summary: 'Cancel a pending or unpaid order',
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
  GuestToken: {
    name: 'token',
    in: 'path',
    required: true,
    schema: { type: 'string', maxLength: 120 },
  },
  OrderId: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
};

const nullableString = { type: ['string', 'null'] };

const totals = {
  subtotalCents: {
    type: 'integer',
    description: 'Items at the prices paid, before any coupon',
    example: 112000,
  },
  promotionDiscountCents: {
    type: 'integer',
    description: 'Taken off by buy X get Y and bundle promotions',
    example: 0,
  },
  discountCents: { type: 'integer', description: 'Taken off by a coupon', example: 0 },
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
  'paymentType',
  'paymentProvider',
  'paymentStatus',
  'paymentDueAt',
  'payment',
  'couponCode',
  'subtotalCents',
  'promotionDiscountCents',
  'discountCents',
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
  paymentType: { type: 'string', enum: ['cod', 'manual'] },
  paymentProvider: { type: ['string', 'null'], example: 'GCash' },
  paymentStatus: { type: 'string', enum: ['unpaid', 'submitted', 'paid', 'refunded'] },
  paymentDueAt: {
    type: ['string', 'null'],
    format: 'date-time',
    description: 'When an unpaid order is cancelled',
  },
  payment: {
    type: ['object', 'null'],
    description: 'Who to pay, while the order is waiting for payment',
    required: ['providerName', 'accountName', 'accountNumber', 'qrUrl'],
    properties: {
      providerName: { type: ['string', 'null'], example: 'GCash' },
      accountName: { type: ['string', 'null'], example: 'Juan Dela Cruz' },
      accountNumber: { type: ['string', 'null'], example: '09171234567' },
      qrUrl: { type: ['string', 'null'], format: 'uri' },
    },
  },
  couponCode: { ...nullableString, example: 'WELCOME10' },
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

const itemInputs = {
  type: 'array',
  minItems: 1,
  maxItems: 100,
  items: {
    type: 'object',
    required: ['variantId', 'quantity'],
    additionalProperties: false,
    properties: {
      variantId: { type: 'string', format: 'uuid' },
      quantity: { type: 'integer', minimum: 1, maximum: 99, example: 2 },
    },
  },
};

export const orderSchemas = {
  OrderPreview: {
    type: 'object',
    required: [
      'items',
      'subtotalCents',
      'promotions',
      'promotionDiscountCents',
      'discountCents',
      'coupon',
      'couponError',
      'freeShippingMinCents',
      'freeShippingRemainingCents',
      'shippingCents',
      'vatableCents',
      'taxCents',
      'totalCents',
      'taxRatePercent',
      'pricesIncludeTax',
    ],
    properties: {
      items: { type: 'array', items: { $ref: '#/components/schemas/CartItem' } },
      promotions: {
        type: 'array',
        description: 'The promotions applied, with what each took off',
        items: {
          type: 'object',
          required: ['id', 'name', 'discountCents'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Buy 2 tees, get 1 free' },
            discountCents: { type: 'integer', example: 1999 },
          },
        },
      },
      coupon: {
        type: ['object', 'null'],
        description:
          'The discount applied, or null. Only one applies: the typed coupon or an automatic one, whichever gives the lower total.',
        required: ['code', 'discountCents', 'freeShipping', 'automatic'],
        properties: {
          code: { type: 'string', example: 'WELCOME10' },
          discountCents: { type: 'integer', example: 20000 },
          freeShipping: { type: 'boolean' },
          automatic: {
            type: 'boolean',
            description: 'True when the discount applied itself, without a code',
          },
        },
      },
      freeShippingMinCents: {
        type: ['integer', 'null'],
        description: 'The subtotal after discounts that ships free, or null when there is none',
        example: 150000,
      },
      freeShippingRemainingCents: {
        type: ['integer', 'null'],
        description:
          'How much more to spend for free shipping: 0 once shipping is free, or null when there is none',
        example: 25000,
      },
      couponError: {
        ...nullableString,
        description: 'Why the coupon sent could not be used, to show the shopper',
        example: 'This coupon has expired',
      },
      ...totals,
    },
  },
  PreviewOrder: {
    type: 'object',
    required: ['items'],
    additionalProperties: false,
    properties: {
      items: { ...itemInputs, minItems: 0 },
      couponCode: { type: 'string', example: 'WELCOME10' },
      email: {
        type: 'string',
        format: 'email',
        description: "A guest's email, to check once-per-customer coupons",
      },
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
      'listPriceCents',
      'promotionDiscountCents',
      'promotionName',
      'discountCents',
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
      unitPriceCents: { type: 'integer', description: 'The price paid', example: 56000 },
      listPriceCents: {
        type: 'integer',
        description: 'The price before any sale. Equal to unitPriceCents when nothing was on sale.',
        example: 70000,
      },
      promotionDiscountCents: {
        type: 'integer',
        description: "The promotion's share of this line",
      },
      promotionName: { ...nullableString, example: 'Buy 2 tees, get 1 free' },
      discountCents: { type: 'integer', description: "The coupon's share of this line" },
      quantity: { type: 'integer', example: 2 },
      taxCents: { type: 'integer', example: 12000 },
      lineTotalCents: {
        type: 'integer',
        description: 'unitPriceCents times quantity, less promotionDiscountCents and discountCents',
        example: 112000,
      },
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
    required: [
      ...orderRequired,
      'userId',
      'isGuest',
      'customerEmail',
      'paymentReference',
      'termsAcceptedAt',
    ],
    properties: {
      ...orderProperties,
      userId: { type: ['string', 'null'], format: 'uuid' },
      isGuest: { type: 'boolean' },
      customerEmail: { type: ['string', 'null'], format: 'email' },
      paymentReference: { type: ['string', 'null'] },
      termsAcceptedAt: {
        type: ['string', 'null'],
        format: 'date-time',
        description: 'When the buyer accepted the terms, if the client sent acceptTerms',
      },
    },
  },
  GuestOrder: {
    type: 'object',
    required: [...orderRequired, 'guestToken'],
    properties: {
      ...orderProperties,
      shippingAddress: {
        ...orderProperties.shippingAddress,
        type: ['object', 'null'],
        description: 'Hidden once the order is delivered, returned, or cancelled',
      },
      guestToken: { type: 'string', description: 'Opens this order. Keep it private.' },
    },
  },
  CreateGuestOrder: {
    type: 'object',
    required: [
      'email',
      'address',
      'items',
      'paymentMethod',
      'expectedTotalCents',
      'idempotencyKey',
    ],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255, example: 'guest@example.com' },
      address: { $ref: '#/components/schemas/CreateAddress' },
      items: itemInputs,
      paymentMethod: {
        type: 'string',
        format: 'uuid',
        description: 'A payment method id. Guests cannot use COD.',
      },
      expectedTotalCents: { type: 'integer', minimum: 0 },
      idempotencyKey: { type: 'string', format: 'uuid' },
      couponCode: {
        type: 'string',
        pattern: '^[A-Za-z0-9_-]{3,32}$',
        description: 'Optional. Fails with 409 and the reason when it cannot be used.',
        example: 'WELCOME10',
      },
      acceptTerms: {
        type: 'boolean',
        description: 'Send true when the buyer ticked the terms box, to record when they agreed',
      },
    },
  },
  SubmitPayment: {
    type: 'object',
    required: ['reference'],
    additionalProperties: false,
    properties: {
      reference: {
        type: 'string',
        minLength: 4,
        maxLength: 100,
        pattern: '^[A-Za-z0-9-]+$',
        example: 'GC-1234567890',
      },
    },
  },
  CreateOrder: {
    type: 'object',
    required: ['addressId', 'paymentMethod', 'expectedTotalCents', 'idempotencyKey'],
    additionalProperties: false,
    properties: {
      addressId: { type: 'string', format: 'uuid' },
      paymentMethod: {
        type: 'string',
        description: '`cod`, or a payment method id from /api/payment-methods',
        example: 'cod',
      },
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
      couponCode: {
        type: 'string',
        pattern: '^[A-Za-z0-9_-]{3,32}$',
        description: 'Optional. Fails with 409 and the reason when it cannot be used.',
        example: 'WELCOME10',
      },
      acceptTerms: {
        type: 'boolean',
        description: 'Send true when the buyer ticked the terms box, to record when they agreed',
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
