import { openApiDocument } from './openapi';

interface Schema {
  $ref?: string;
  type?: string | string[];
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  minimum?: number;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
}

interface Parameter {
  $ref?: string;
  name: string;
  in: string;
  schema: Schema;
}

interface Operation {
  tags: string[];
  summary: string;
  description?: string;
  security?: unknown[];
  parameters?: Parameter[];
  requestBody?: { content: Record<string, { schema: Schema }> };
}

const document = openApiDocument as unknown as {
  info: { title: string };
  tags: { name: string }[];
  paths: Record<string, Record<string, Operation>>;
  components: { parameters: Record<string, Parameter>; schemas: Record<string, Schema> };
};

/** Lets a saved id flow into the following requests. */
const bodyVariables: Record<string, string> = {
  addressId: '{{addressId}}',
  assetId: '{{assetId}}',
  mobileAssetId: '{{assetId}}',
  categoryId: '{{categoryId}}',
  coverAssetId: '{{assetId}}',
  expectedTotalCents: '{{expectedTotalCents}}',
  idempotencyKey: '{{$guid}}',
  refreshToken: '{{refreshToken}}',
  variantId: '{{variantId}}',
};

const idVariablesByTag: Record<string, string> = {
  Addresses: 'addressId',
  Assets: 'assetId',
  Banners: 'bannerId',
  Blogs: 'blogId',
  Categories: 'categoryId',
  Orders: 'orderId',
  'Payment Methods': 'paymentMethodId',
  Products: 'productId',
};

const createdIdVariables: Record<string, string> = {
  '/api/addresses': 'addressId',
  '/api/assets': 'assetId',
  '/api/banners': 'bannerId',
  '/api/blogs': 'blogId',
  '/api/categories': 'categoryId',
  '/api/orders': 'orderId',
  '/api/payment-methods': 'paymentMethodId',
  '/api/products': 'productId',
  '/api/products/{id}/images': 'imageId',
  '/api/products/{id}/variants': 'variantId',
};

function refName(ref: string) {
  return ref.slice(ref.lastIndexOf('/') + 1);
}

function resolveSchema(schema: Schema): Schema {
  const resolved = schema.$ref && document.components.schemas[refName(schema.$ref)];
  return resolved || schema;
}

function resolveParameter(parameter: Parameter) {
  const resolved = parameter.$ref && document.components.parameters[refName(parameter.$ref)];
  return resolved || parameter;
}

function sampleValue(input: Schema): unknown {
  const schema = resolveSchema(input);

  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum) return schema.enum[0];

  if (schema.properties) {
    const entries = Object.entries(schema.properties)
      .filter(
        ([name, property]) =>
          schema.required?.includes(name) ||
          name === 'refreshToken' ||
          property.example !== undefined,
      )
      .map(([name, property]) => [
        name,
        name === 'paymentMethod' && property.format === 'uuid'
          ? '{{paymentMethodId}}'
          : (bodyVariables[name] ?? sampleValue(property)),
      ]);

    return Object.fromEntries(entries);
  }

  if (schema.items) return [sampleValue(schema.items)];

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  if (type === 'integer') return schema.minimum ?? 1;
  if (type === 'boolean') return true;
  return '';
}

function requestBody({ requestBody }: Operation) {
  if (!requestBody) return undefined;

  const json = requestBody.content['application/json'];

  if (json) {
    return {
      mode: 'raw',
      raw: JSON.stringify(sampleValue(json.schema), null, 2),
      options: { raw: { language: 'json' } },
    };
  }

  return { mode: 'formdata', formdata: [{ key: 'file', type: 'file', src: [] }] };
}

function pathVariableValue(name: string, tag: string) {
  if (name === 'token') return '{{guestToken}}';
  return `{{${name === 'id' ? idVariablesByTag[tag] : name}}}`;
}

function requestUrl(path: string, operation: Operation) {
  const tag = operation.tags[0] ?? '';
  const parameters = (operation.parameters ?? []).map(resolveParameter);
  const postmanPath = path.replace(/\{(\w+)\}/g, ':$1');

  return {
    raw: `{{baseUrl}}${postmanPath}`,
    host: ['{{baseUrl}}'],
    path: postmanPath.split('/').filter(Boolean),
    query: parameters
      .filter((parameter) => parameter.in === 'query')
      .map(({ name, schema }) => ({
        key: name,
        value: String(schema.default ?? ''),
        disabled: true,
      })),
    variable: parameters
      .filter((parameter) => parameter.in === 'path')
      .map(({ name }) => ({ key: name, value: pathVariableValue(name, tag) })),
  };
}

function testScript(path: string) {
  if (path === '/api/auth/login' || path === '/api/auth/refresh') {
    return [
      'if (pm.response.code === 200) {',
      '  const { accessToken, refreshToken } = pm.response.json().data;',
      "  pm.collectionVariables.set('accessToken', accessToken);",
      "  if (refreshToken) pm.collectionVariables.set('refreshToken', refreshToken);",
      '}',
    ];
  }

  if (path === '/api/orders/guest') {
    return [
      'if (pm.response.code === 201) {',
      "  pm.collectionVariables.set('guestToken', pm.response.json().data.guestToken);",
      '}',
    ];
  }

  if (path === '/api/orders/preview') {
    return [
      'if (pm.response.code === 200) {',
      "  pm.collectionVariables.set('expectedTotalCents', pm.response.json().data.totalCents);",
      '}',
    ];
  }

  const variable = createdIdVariables[path];

  if (!variable) return undefined;

  return [
    'if (pm.response.code === 201) {',
    '  const { data } = pm.response.json();',
    `  pm.collectionVariables.set('${variable}', data.id);`,
    "  if (data.variants) pm.collectionVariables.set('variantId', data.variants[0].id);",
    '}',
  ];
}

function toItem(path: string, method: string, operation: Operation) {
  const body = requestBody(operation);
  const script = method === 'post' ? testScript(path) : undefined;

  return {
    name: operation.summary,
    ...(script && {
      event: [{ listen: 'test', script: { type: 'text/javascript', exec: script } }],
    }),
    request: {
      method: method.toUpperCase(),
      ...(operation.security ? {} : { auth: { type: 'noauth' } }),
      ...(operation.description && { description: operation.description }),
      header: [],
      url: requestUrl(path, operation),
      ...(body && { body }),
    },
  };
}

export function buildPostmanCollection() {
  const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({ path, method, operation })),
  );

  return {
    info: {
      name: document.info.title,
      description:
        'Generated from the OpenAPI document by npm run postman. Log in first, as tokens and created ids are saved to collection variables.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
    },
    variable: [
      { key: 'baseUrl', value: 'http://localhost:3000' },
      ...[
        'accessToken',
        'refreshToken',
        'addressId',
        'assetId',
        'blogId',
        'categoryId',
        'expectedTotalCents',
        'guestToken',
        'imageId',
        'orderId',
        'paymentMethodId',
        'productId',
        'variantId',
      ].map((key) => ({ key, value: '' })),
    ],
    item: document.tags.map(({ name }) => ({
      name,
      item: operations
        .filter(({ operation }) => operation.tags.includes(name))
        .map(({ path, method, operation }) => toItem(path, method, operation)),
    })),
  };
}
