import { socialPlatforms } from './store-info.schema';
import { MAX_SOCIAL_LINKS } from './store-info.validation';

const dataContent = {
  'application/json': {
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: '#/components/schemas/StoreInfo' } },
    },
  },
};

const tags = ['Store Info'];

export const storeInfoPaths = {
  '/api/store-info': {
    get: {
      tags,
      summary: "Get the store's contact details and social links",
      description: 'Empty fields are null, so the storefront can hide them.',
      responses: {
        200: { description: 'The store info', content: dataContent },
        500: { $ref: '#/components/responses/ServerError' },
      },
    },
    put: {
      tags,
      summary: 'Save the store info (needs store.manage)',
      description:
        'Saves the whole form. Omitted fields are cleared, and socialLinks is saved in the order sent.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/StoreInfoBody' } },
        },
      },
      responses: {
        200: { description: 'The saved store info', content: dataContent },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        500: { $ref: '#/components/responses/ServerError' },
      },
    },
  },
};

const nullableText = (maxLength: number, example: string) => ({
  type: ['string', 'null'],
  maxLength,
  example,
});

const fields = {
  name: { type: 'string', maxLength: 100, example: 'Simple Store' },
  email: { type: ['string', 'null'], format: 'email', example: 'hello@example.com' },
  phone: nullableText(30, '(02) 8123 4567'),
  line1: nullableText(255, '123 Rizal Street'),
  line2: nullableText(255, 'Unit 4B'),
  barangay: nullableText(100, 'Poblacion'),
  city: nullableText(100, 'Makati'),
  province: nullableText(100, 'Metro Manila'),
  postalCode: { type: ['string', 'null'], pattern: '^\\d{4}$', example: '1210' },
  businessHours: nullableText(200, 'Mon to Sat, 9am to 6pm'),
  socialLinks: {
    type: 'array',
    maxItems: MAX_SOCIAL_LINKS,
    description: 'In display order. The storefront picks each icon from platform.',
    items: {
      type: 'object',
      required: ['platform', 'url'],
      properties: {
        platform: { type: 'string', enum: [...socialPlatforms] },
        url: { type: 'string', pattern: '^https://', example: 'https://facebook.com/simplestore' },
        label: nullableText(50, 'Outlet store'),
      },
    },
  },
};

export const storeInfoSchemas = {
  StoreInfo: {
    type: 'object',
    required: [...Object.keys(fields), 'updatedAt'],
    properties: { ...fields, updatedAt: { type: 'string', format: 'date-time' } },
  },
  StoreInfoBody: {
    type: 'object',
    required: ['name'],
    properties: fields,
  },
};
