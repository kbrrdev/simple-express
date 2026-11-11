import { auditEntityTypes } from './audit-log.schema';

const tags = ['Audit Logs'];
const security = [{ bearerAuth: [] }];
const uuid = { type: 'string', format: 'uuid' };
const date = { type: 'string', format: 'date', example: '2026-03-01' };

export const auditLogPaths = {
  '/api/audit-logs': {
    get: {
      tags,
      summary: 'List changes made by admins and to accounts, newest first (needs audit_logs.view)',
      description:
        'Records admin changes to products, variants, images, categories, blogs, payment methods, files, and orders, and changes to passwords, sessions, and roles. Entries cannot be edited or deleted. Dates follow Manila time, and both are included.',
      security,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        { name: 'actorUserId', in: 'query', schema: uuid },
        {
          name: 'entityType',
          in: 'query',
          schema: { type: 'string', enum: [...auditEntityTypes] },
        },
        { name: 'entityId', in: 'query', schema: uuid },
        {
          name: 'action',
          in: 'query',
          schema: { type: 'string', maxLength: 50, example: 'update' },
        },
        { name: 'from', in: 'query', description: 'First day, in Manila time', schema: date },
        { name: 'to', in: 'query', description: 'Last day, in Manila time', schema: date },
      ],
      responses: {
        200: {
          description: 'A page of entries',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data', 'meta'],
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/AuditLog' } },
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
};

export const auditLogSchemas = {
  AuditLog: {
    type: 'object',
    required: [
      'id',
      'actorUserId',
      'actorEmail',
      'entityType',
      'entityId',
      'action',
      'changes',
      'requestId',
      'createdAt',
    ],
    properties: {
      id: uuid,
      actorUserId: {
        ...uuid,
        type: ['string', 'null'],
        description: 'Null for scripts and timers',
      },
      actorEmail: { type: ['string', 'null'] },
      entityType: { type: 'string', enum: [...auditEntityTypes] },
      entityId: uuid,
      action: { type: 'string', example: 'update' },
      changes: {
        type: 'object',
        description:
          'Each changed field as [before, after]. Account numbers and password hashes show as "[redacted]".',
        additionalProperties: { type: 'array', minItems: 2, maxItems: 2 },
        example: { priceCents: [129900, 99900] },
      },
      requestId: {
        ...uuid,
        type: ['string', 'null'],
        description: 'Matches the requestId in the server logs',
      },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
};
