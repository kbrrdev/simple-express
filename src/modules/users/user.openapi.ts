const roleSummary = {
  type: ['object', 'null'],
  description: 'Null for customers',
  required: ['id', 'name'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', example: 'Staff' },
  },
};

export const userPaths = {
  '/api/users': {
    get: {
      tags: ['Users'],
      summary: 'Find users to give a role, newest first (super admin)',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        {
          name: 'search',
          in: 'query',
          description: 'Part of the email, ignoring case',
          schema: { type: 'string', minLength: 1, maxLength: 255, example: 'jane' },
        },
        {
          name: 'type',
          in: 'query',
          description:
            '`staff` lists everyone with a role, for a CMS users screen. `customer` lists everyone without one, for finding someone to promote.',
          schema: { type: 'string', enum: ['staff', 'customer'] },
        },
        {
          name: 'roleId',
          in: 'query',
          description: 'Only users with this role',
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        200: {
          description: 'A page of users',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data', 'meta'],
                properties: {
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['id', 'email', 'role', 'createdAt'],
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        email: { type: 'string', format: 'email' },
                        role: roleSummary,
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                  meta: { $ref: '#/components/schemas/PageMeta' },
                },
              },
            },
          },
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        500: { $ref: '#/components/responses/ServerError' },
      },
    },
  },
  '/api/users/{id}/role': {
    patch: {
      tags: ['Users'],
      summary: "Change a user's role (super admin)",
      description:
        'Send `roleId: null` to make the user a customer. Super admins cannot change their own role, so the store always keeps one. The change applies on the next request.',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['roleId'],
              additionalProperties: false,
              properties: { roleId: { type: ['string', 'null'], format: 'uuid' } },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'The user with their new role',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: { data: { $ref: '#/components/schemas/User' } },
              },
            },
          },
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
        409: { $ref: '#/components/responses/Conflict' },
        500: { $ref: '#/components/responses/ServerError' },
      },
    },
  },
};
