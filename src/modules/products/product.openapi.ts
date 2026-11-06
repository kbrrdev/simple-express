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

const productPageContent = {
  'application/json': {
    schema: {
      type: 'object',
      required: ['data', 'meta'],
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
        meta: { $ref: '#/components/schemas/PageMeta' },
      },
    },
  },
};

const listParameters = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
  {
    name: 'search',
    in: 'query',
    description: 'Matches part of the product name, ignoring case',
    schema: { type: 'string', maxLength: 255 },
  },
  { name: 'categoryId', in: 'query', schema: { type: 'string', format: 'uuid' } },
  {
    name: 'sort',
    in: 'query',
    schema: { type: 'string', enum: ['newest', 'name'], default: 'newest' },
  },
];

const badRequest = { $ref: '#/components/responses/BadRequest' };
const unauthorized = { $ref: '#/components/responses/Unauthorized' };
const forbidden = { $ref: '#/components/responses/Forbidden' };
const notFound = { $ref: '#/components/responses/NotFound' };
const conflict = { $ref: '#/components/responses/Conflict' };
const serverError = { $ref: '#/components/responses/ServerError' };
const productId = { $ref: '#/components/parameters/ProductId' };
const variantId = { $ref: '#/components/parameters/VariantId' };
const imageId = { $ref: '#/components/parameters/ImageId' };

const tags = ['Products'];
const security = [{ bearerAuth: [] }];

export const productPaths = {
  '/api/products': {
    get: {
      tags,
      summary: 'List products on sale',
      description: 'Returns active products that have at least one active variant.',
      parameters: listParameters,
      responses: {
        200: { description: 'A page of products', content: productPageContent },
        400: badRequest,
        500: serverError,
      },
    },
    post: {
      tags,
      summary: 'Create a product and its variants (admin)',
      security,
      requestBody: jsonBody('CreateProduct'),
      responses: {
        201: {
          description: 'The created product',
          headers: {
            Location: { description: 'URL of the created product', schema: { type: 'string' } },
          },
          content: dataContent('Product'),
        },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/products/admin': {
    get: {
      tags,
      summary: 'List all products, including inactive ones (admin)',
      security,
      parameters: listParameters,
      responses: {
        200: { description: 'A page of products', content: productPageContent },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  },
  '/api/products/{id}': {
    get: {
      tags,
      summary: 'Get a product on sale',
      parameters: [productId],
      responses: {
        200: { description: 'The product', content: dataContent('Product') },
        400: badRequest,
        404: notFound,
        500: serverError,
      },
    },
    patch: {
      tags,
      summary: 'Update a product (admin)',
      description: 'Existing options can be renamed, but options cannot be added.',
      security,
      parameters: [productId],
      requestBody: jsonBody('UpdateProduct'),
      responses: {
        200: { description: 'The updated product', content: dataContent('Product') },
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
      summary: 'Deactivate a product (admin)',
      description: 'The product is kept, and can be restored by setting `active` to true.',
      security,
      parameters: [productId],
      responses: {
        204: { description: 'The product was deactivated' },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
  },
  '/api/products/{id}/images': {
    post: {
      tags,
      summary: 'Add an uploaded asset to a product (admin)',
      description: 'A product can have up to 10 images.',
      security,
      parameters: [productId],
      requestBody: jsonBody('AddProductImage'),
      responses: {
        201: { description: 'The added image', content: dataContent('ProductImage') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/products/{id}/images/{imageId}': {
    patch: {
      tags,
      summary: 'Change the alt text or position of an image (admin)',
      security,
      parameters: [productId, imageId],
      requestBody: jsonBody('UpdateProductImage'),
      responses: {
        200: { description: 'The updated image', content: dataContent('ProductImage') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
    delete: {
      tags,
      summary: 'Remove an image from a product (admin)',
      description: 'The uploaded file is kept. Fails with 409 while a variant uses the image.',
      security,
      parameters: [productId, imageId],
      responses: {
        204: { description: 'The image was removed' },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/products/{id}/variants': {
    post: {
      tags,
      summary: 'Add a variant (admin)',
      security,
      parameters: [productId],
      requestBody: jsonBody('CreateVariant'),
      responses: {
        201: { description: 'The created variant', content: dataContent('ProductVariant') },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/products/{id}/variants/{variantId}': {
    patch: {
      tags,
      summary: 'Update a variant (admin)',
      security,
      parameters: [productId, variantId],
      requestBody: jsonBody('UpdateVariant'),
      responses: {
        200: { description: 'The updated variant', content: dataContent('ProductVariant') },
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
      summary: 'Deactivate a variant (admin)',
      security,
      parameters: [productId, variantId],
      responses: {
        204: { description: 'The variant was deactivated' },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
  },
};

export const productParameters = {
  ProductId: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  ImageId: {
    name: 'imageId',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  VariantId: {
    name: 'variantId',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
};

const optionName = { type: 'string', minLength: 1, maxLength: 50, example: 'Size' };
const optionValue = { type: 'string', minLength: 1, maxLength: 100, example: 'M' };
const priceCents = {
  type: 'integer',
  minimum: 0,
  maximum: 2147483647,
  description: 'Price in cents',
  example: 1999,
};
const stock = { type: 'integer', minimum: 0, maximum: 2147483647, example: 12 };

const variantInput = {
  option1Value: {
    ...optionValue,
    description: 'Required when the product has a first option, and not allowed otherwise',
  },
  option2Value: {
    ...optionValue,
    example: 'Red',
    description: 'Required when the product has a second option, and not allowed otherwise',
  },
  priceCents,
  stock: { ...stock, default: 0 },
  active: { type: 'boolean', default: true },
};

export const productSchemas = {
  Product: {
    type: 'object',
    required: [
      'id',
      'categoryId',
      'name',
      'description',
      'option1Name',
      'option2Name',
      'active',
      'createdAt',
      'updatedAt',
      'images',
      'variants',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      categoryId: { type: 'string', format: 'uuid' },
      name: { type: 'string', maxLength: 255, example: 'Classic T-Shirt' },
      description: { type: 'string' },
      option1Name: { type: ['string', 'null'], maxLength: 50, example: 'Size' },
      option2Name: { type: ['string', 'null'], maxLength: 50, example: 'Color' },
      active: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      images: { type: 'array', items: { $ref: '#/components/schemas/ProductImage' } },
      variants: { type: 'array', items: { $ref: '#/components/schemas/ProductVariant' } },
    },
  },
  ProductVariant: {
    type: 'object',
    required: [
      'id',
      'productId',
      'option1Value',
      'option2Value',
      'assetId',
      'priceCents',
      'stock',
      'active',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      productId: { type: 'string', format: 'uuid' },
      option1Value: { type: ['string', 'null'], maxLength: 100, example: 'M' },
      option2Value: { type: ['string', 'null'], maxLength: 100, example: 'Red' },
      assetId: {
        type: ['string', 'null'],
        format: 'uuid',
        description: 'The product image for this variant',
      },
      priceCents,
      stock,
      active: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateProduct: {
    type: 'object',
    required: ['categoryId', 'name', 'variants'],
    additionalProperties: false,
    properties: {
      categoryId: { type: 'string', format: 'uuid' },
      name: { type: 'string', minLength: 1, maxLength: 255, example: 'Classic T-Shirt' },
      description: { type: 'string', maxLength: 10000 },
      option1Name: optionName,
      option2Name: { ...optionName, example: 'Color', description: 'Requires option1Name' },
      active: { type: 'boolean', default: true },
      variants: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: { $ref: '#/components/schemas/CreateVariant' },
      },
    },
  },
  UpdateProduct: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: {
      categoryId: { type: 'string', format: 'uuid' },
      name: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 10000 },
      option1Name: optionName,
      option2Name: { ...optionName, example: 'Color' },
      active: { type: 'boolean' },
    },
  },
  CreateVariant: {
    type: 'object',
    required: ['priceCents'],
    additionalProperties: false,
    properties: variantInput,
  },
  UpdateVariant: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: {
      ...variantInput,
      assetId: {
        type: ['string', 'null'],
        format: 'uuid',
        description: "Must be one of the product's images",
      },
    },
  },
  ProductImage: {
    type: 'object',
    required: ['id', 'productId', 'assetId', 'url', 'altText', 'position'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      productId: { type: 'string', format: 'uuid' },
      assetId: { type: 'string', format: 'uuid' },
      url: { type: 'string', format: 'uri' },
      altText: { type: 'string', maxLength: 255 },
      position: { type: 'integer', minimum: 0 },
    },
  },
  AddProductImage: {
    type: 'object',
    required: ['assetId'],
    additionalProperties: false,
    properties: {
      assetId: { type: 'string', format: 'uuid' },
      altText: { type: 'string', maxLength: 255 },
    },
  },
  UpdateProductImage: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: {
      altText: { type: 'string', maxLength: 255, example: 'Front view' },
      position: { type: 'integer', minimum: 0, maximum: 1000, example: 1 },
    },
  },
};
