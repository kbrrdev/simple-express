const addressContent = {
  'application/json': {
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: '#/components/schemas/Address' } },
    },
  },
};

const badRequest = { $ref: '#/components/responses/BadRequest' };
const unauthorized = { $ref: '#/components/responses/Unauthorized' };
const notFound = { $ref: '#/components/responses/NotFound' };
const conflict = { $ref: '#/components/responses/Conflict' };
const serverError = { $ref: '#/components/responses/ServerError' };
const addressId = { $ref: '#/components/parameters/AddressId' };

const tags = ['Addresses'];
const security = [{ bearerAuth: [] }];

export const addressPaths = {
  '/api/addresses': {
    get: {
      tags,
      summary: 'List the current user’s addresses, default first',
      security,
      responses: {
        200: {
          description: 'The addresses',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data', 'meta'],
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Address' } },
                  meta: { $ref: '#/components/schemas/PageMeta' },
                },
              },
            },
          },
        },
        401: unauthorized,
        500: serverError,
      },
    },
    post: {
      tags,
      summary: 'Add an address',
      description: 'A user’s first address becomes the default. A user can save up to 20.',
      security,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CreateAddress' } },
        },
      },
      responses: {
        201: {
          description: 'The created address',
          headers: {
            Location: { description: 'URL of the created address', schema: { type: 'string' } },
          },
          content: addressContent,
        },
        400: badRequest,
        401: unauthorized,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/addresses/{id}': {
    get: {
      tags,
      summary: 'Get an address',
      security,
      parameters: [addressId],
      responses: {
        200: { description: 'The address', content: addressContent },
        400: badRequest,
        401: unauthorized,
        404: notFound,
        500: serverError,
      },
    },
    patch: {
      tags,
      summary: 'Update an address',
      security,
      parameters: [addressId],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/UpdateAddress' } },
        },
      },
      responses: {
        200: { description: 'The updated address', content: addressContent },
        400: badRequest,
        401: unauthorized,
        404: notFound,
        500: serverError,
      },
    },
    delete: {
      tags,
      summary: 'Delete an address',
      description: 'Deleting the default makes the newest remaining address the default.',
      security,
      parameters: [addressId],
      responses: {
        204: { description: 'The address was deleted' },
        400: badRequest,
        401: unauthorized,
        404: notFound,
        500: serverError,
      },
    },
  },
  '/api/addresses/{id}/default': {
    post: {
      tags,
      summary: 'Make an address the default',
      security,
      parameters: [addressId],
      responses: {
        200: { description: 'The new default address', content: addressContent },
        400: badRequest,
        401: unauthorized,
        404: notFound,
        500: serverError,
      },
    },
  },
};

export const addressParameters = {
  AddressId: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
};

const addressFields = {
  recipientName: { type: 'string', minLength: 1, maxLength: 100, example: 'Juan Dela Cruz' },
  phone: {
    type: 'string',
    description: 'Philippine mobile number. Stored as +639171234567.',
    example: '09171234567',
  },
  line1: {
    type: 'string',
    minLength: 1,
    maxLength: 255,
    description: 'House or unit number and street',
    example: '123 Rizal Street',
  },
  line2: {
    type: 'string',
    maxLength: 255,
    description: 'Building or subdivision',
    example: 'Sunrise Village',
  },
  barangay: { type: 'string', minLength: 1, maxLength: 100, example: 'San Antonio' },
  city: {
    type: 'string',
    minLength: 1,
    maxLength: 100,
    description: 'City or municipality',
    example: 'Pasig',
  },
  province: {
    type: 'string',
    minLength: 1,
    maxLength: 100,
    description: 'Use Metro Manila for addresses in the capital region',
    example: 'Metro Manila',
  },
  postalCode: { type: 'string', pattern: '^\\d{4}$', example: '1605' },
};

export const addressSchemas = {
  Address: {
    type: 'object',
    required: [
      'id',
      'userId',
      'recipientName',
      'phone',
      'line1',
      'line2',
      'barangay',
      'city',
      'province',
      'postalCode',
      'isDefault',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      userId: { type: 'string', format: 'uuid' },
      ...addressFields,
      phone: { type: 'string', pattern: '^\\+639\\d{9}$', example: '+639171234567' },
      isDefault: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateAddress: {
    type: 'object',
    required: ['recipientName', 'phone', 'line1', 'barangay', 'city', 'province', 'postalCode'],
    additionalProperties: false,
    properties: addressFields,
  },
  UpdateAddress: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: addressFields,
  },
};
