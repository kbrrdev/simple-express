const badRequest = { $ref: '#/components/responses/BadRequest' };
const unauthorized = { $ref: '#/components/responses/Unauthorized' };
const forbidden = { $ref: '#/components/responses/Forbidden' };
const notFound = { $ref: '#/components/responses/NotFound' };
const conflict = { $ref: '#/components/responses/Conflict' };
const payloadTooLarge = { $ref: '#/components/responses/PayloadTooLarge' };
const serverError = { $ref: '#/components/responses/ServerError' };

const tags = ['Assets'];
const security = [{ bearerAuth: [] }];

export const assetPaths = {
  '/api/assets': {
    get: {
      tags,
      summary: 'List uploaded files, newest first (admin)',
      security,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        200: {
          description: 'A page of assets',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data', 'meta'],
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Asset' } },
                  meta: { $ref: '#/components/schemas/PageMeta' },
                },
              },
            },
          },
        },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
    post: {
      tags,
      summary: 'Upload an image (admin)',
      description:
        'Accepts one JPEG, PNG, or WebP image of up to 5 MB. Attach it to a product or blog using the returned id.',
      security,
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: { file: { type: 'string', format: 'binary' } },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'The uploaded asset',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: { data: { $ref: '#/components/schemas/Asset' } },
              },
            },
          },
        },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        413: payloadTooLarge,
        500: serverError,
      },
    },
  },
  '/api/assets/{id}': {
    delete: {
      tags,
      summary: 'Delete an uploaded file (admin)',
      description: 'Fails with 409 while a product or blog uses the asset.',
      security,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        204: { description: 'The asset was deleted' },
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

export const assetSchemas = {
  Asset: {
    type: 'object',
    required: ['id', 'url', 'mimeType', 'sizeBytes', 'createdAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      url: { type: 'string', format: 'uri' },
      mimeType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'] },
      sizeBytes: { type: 'integer', example: 204800 },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
};
