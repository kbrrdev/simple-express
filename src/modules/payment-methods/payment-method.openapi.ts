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
const paymentMethodId = { $ref: '#/components/parameters/PaymentMethodId' };

const tags = ['Payment Methods'];
const security = [{ bearerAuth: [] }];

export const paymentMethodPaths = {
  '/api/payment-methods': {
    get: {
      tags,
      summary: 'List the payment methods customers can choose',
      description:
        'Returns enabled methods only. Account details are shown on the order after checkout. COD is always available to logged-in customers, and is not listed.',
      responses: {
        200: { description: 'The enabled methods', content: pageContent('PaymentMethodOption') },
        500: serverError,
      },
    },
    post: {
      tags,
      summary: 'Add a payment method (needs payment_methods.manage)',
      description: 'Upload a QR image through /api/assets first, then send its id as qrAssetId.',
      security,
      requestBody: jsonBody('CreatePaymentMethod'),
      responses: {
        201: { description: 'The created method', content: dataContent('PaymentMethod') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/payment-methods/admin': {
    get: {
      tags,
      summary: 'List all payment methods with account details (needs payment_methods.manage)',
      security,
      responses: {
        200: { description: 'All methods', content: pageContent('PaymentMethod') },
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  },
  '/api/payment-methods/{id}': {
    patch: {
      tags,
      summary: 'Update a payment method (needs payment_methods.manage)',
      description: 'Orders already placed keep the details they were given.',
      security,
      parameters: [paymentMethodId],
      requestBody: jsonBody('UpdatePaymentMethod'),
      responses: {
        200: { description: 'The updated method', content: dataContent('PaymentMethod') },
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
      summary: 'Delete a payment method (needs payment_methods.manage)',
      description: 'Fails with 409 once orders use it. Set enabled to false instead.',
      security,
      parameters: [paymentMethodId],
      responses: {
        204: { description: 'The method was deleted' },
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

export const paymentMethodParameters = {
  PaymentMethodId: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
};

const providerName = { type: 'string', minLength: 1, maxLength: 100, example: 'GCash' };
const accountName = { type: 'string', minLength: 1, maxLength: 100, example: 'Juan Dela Cruz' };
const accountNumber = {
  type: 'string',
  minLength: 1,
  maxLength: 100,
  description: 'A mobile number, bank account number, or email',
  example: '09171234567',
};
const qrAssetId = { type: ['string', 'null'], format: 'uuid' };

export const paymentMethodSchemas = {
  PaymentMethodOption: {
    type: 'object',
    required: ['id', 'type', 'providerName'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      type: { type: 'string', enum: ['manual'] },
      providerName,
    },
  },
  PaymentMethod: {
    type: 'object',
    required: [
      'id',
      'type',
      'providerName',
      'accountName',
      'accountNumber',
      'qrAssetId',
      'qrUrl',
      'enabled',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      type: { type: 'string', enum: ['manual'] },
      providerName,
      accountName,
      accountNumber,
      qrAssetId,
      qrUrl: { type: ['string', 'null'], format: 'uri' },
      enabled: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreatePaymentMethod: {
    type: 'object',
    required: ['providerName', 'accountName', 'accountNumber'],
    additionalProperties: false,
    properties: {
      providerName,
      accountName,
      accountNumber,
      qrAssetId,
      enabled: { type: 'boolean', default: true },
    },
  },
  UpdatePaymentMethod: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: {
      providerName,
      accountName,
      accountNumber,
      qrAssetId,
      enabled: { type: 'boolean' },
    },
  },
};
