export const userPaths = {
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
