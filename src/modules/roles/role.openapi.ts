import { allPermissions } from './permissions';

const badRequest = { $ref: '#/components/responses/BadRequest' };
const unauthorized = { $ref: '#/components/responses/Unauthorized' };
const forbidden = { $ref: '#/components/responses/Forbidden' };
const notFound = { $ref: '#/components/responses/NotFound' };
const conflict = { $ref: '#/components/responses/Conflict' };
const serverError = { $ref: '#/components/responses/ServerError' };

const tags = ['Roles'];
const security = [{ bearerAuth: [] }];
const roleId = { $ref: '#/components/parameters/RoleId' };

const roleContent = {
  'application/json': {
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: '#/components/schemas/Role' } },
    },
  },
};

const permissionList = {
  type: 'array',
  uniqueItems: true,
  items: { type: 'string', enum: allPermissions },
  example: ['blogs.manage', 'assets.manage'],
};

export const rolePaths = {
  '/api/roles/permissions': {
    get: {
      tags,
      summary: 'List every permission, for the role editor (super admin)',
      security,
      responses: {
        200: {
          description: 'The permissions',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: {
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['key', 'description'],
                      properties: {
                        key: { type: 'string', enum: allPermissions },
                        description: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  },
  '/api/roles': {
    get: {
      tags,
      summary: 'List roles (super admin)',
      security,
      responses: {
        200: {
          description: 'The roles',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Role' } },
                },
              },
            },
          },
        },
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
    post: {
      tags,
      summary: 'Create a role (super admin)',
      security,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CreateRoleBody' } },
        },
      },
      responses: {
        201: { description: 'The created role', content: roleContent },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        409: conflict,
        500: serverError,
      },
    },
  },
  '/api/roles/{id}': {
    get: {
      tags,
      summary: 'Get a role (super admin)',
      security,
      parameters: [roleId],
      responses: {
        200: { description: 'The role', content: roleContent },
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
    patch: {
      tags,
      summary: 'Rename a role or change its permissions (super admin)',
      description:
        'Sending `permissions` replaces the whole list. Users with the role get the new permissions on their next request. The Super admin role cannot be changed.',
      security,
      parameters: [roleId],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/UpdateRoleBody' } },
        },
      },
      responses: {
        200: { description: 'The updated role', content: roleContent },
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
      summary: 'Delete a role that no user has (super admin)',
      security,
      parameters: [roleId],
      responses: {
        204: { description: 'The role was deleted' },
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

export const roleParameters = {
  RoleId: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
};

export const roleSchemas = {
  Role: {
    type: 'object',
    required: [
      'id',
      'name',
      'description',
      'builtIn',
      'permissions',
      'userCount',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string', example: 'Staff' },
      description: { type: 'string' },
      builtIn: {
        type: 'boolean',
        description: 'True for Super admin, which has every permission and cannot be changed',
      },
      permissions: permissionList,
      userCount: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateRoleBody: {
    type: 'object',
    required: ['name', 'permissions'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 50, example: 'Content Editor' },
      description: { type: 'string', maxLength: 500, example: 'Writes blogs' },
      permissions: permissionList,
    },
  },
  UpdateRoleBody: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 50 },
      description: { type: 'string', maxLength: 500 },
      permissions: permissionList,
    },
  },
};
