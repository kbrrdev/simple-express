import { allPermissions } from '../roles/permissions';

const badRequest = { $ref: '#/components/responses/BadRequest' };
const unauthorized = { $ref: '#/components/responses/Unauthorized' };
const tooManyRequests = { $ref: '#/components/responses/TooManyRequests' };
const serverError = { $ref: '#/components/responses/ServerError' };

const tags = ['Auth'];
const security = [{ bearerAuth: [] }];

const userContent = {
  'application/json': {
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: '#/components/schemas/User' } },
    },
  },
};

export const authPaths = {
  '/api/auth/register': {
    post: {
      tags,
      summary: 'Create a user',
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/RegisterBody' } },
        },
      },
      responses: {
        201: { description: 'The created user', content: userContent },
        400: badRequest,
        409: {
          description: 'The email is already registered',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Error' } },
          },
        },
        429: tooManyRequests,
        500: serverError,
      },
    },
  },
  '/api/auth/login': {
    post: {
      tags,
      summary: 'Log in and start a session',
      description:
        'With client `web`, the refresh token is set as an httpOnly cookie. With client `native`, it is returned in the body.',
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/LoginBody' } },
        },
      },
      responses: {
        200: {
          description: 'The user and tokens',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: {
                  data: {
                    type: 'object',
                    required: ['user', 'accessToken'],
                    properties: {
                      user: { $ref: '#/components/schemas/User' },
                      accessToken: { type: 'string' },
                      refreshToken: { type: 'string', description: 'Native clients only' },
                    },
                  },
                },
              },
            },
          },
        },
        400: badRequest,
        401: unauthorized,
        429: tooManyRequests,
        500: serverError,
      },
    },
  },
  '/api/auth/refresh': {
    post: {
      tags,
      summary: 'Get new tokens',
      description:
        'Native clients send the refresh token in the body. Web clients send an empty request with the cookie. Each refresh token works once, so store the new one.',
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: { refreshToken: { type: 'string', maxLength: 128 } },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'New tokens',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: {
                  data: {
                    type: 'object',
                    required: ['accessToken'],
                    properties: {
                      accessToken: { type: 'string' },
                      refreshToken: { type: 'string', description: 'Native clients only' },
                    },
                  },
                },
              },
            },
          },
        },
        400: badRequest,
        401: unauthorized,
        429: tooManyRequests,
        500: serverError,
      },
    },
  },
  '/api/auth/change-password': {
    post: {
      tags,
      summary: 'Change the current user’s password',
      description: 'The current session stays active, and all others are revoked.',
      security,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ChangePasswordBody' } },
        },
      },
      responses: {
        204: { description: 'The password was changed' },
        400: badRequest,
        401: unauthorized,
        429: tooManyRequests,
        500: serverError,
      },
    },
  },
  '/api/auth/forgot-password': {
    post: {
      tags,
      summary: 'Email a password reset link',
      description:
        'Always returns 202, whether or not the email has an account. The link opens `PASSWORD_RESET_URL` with `#token=...`, and expires in 30 minutes. Only the newest link works, and each account gets at most three an hour.',
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ForgotPasswordBody' } },
        },
      },
      responses: {
        202: { description: 'If the email has an account, a reset link is sent' },
        400: badRequest,
        429: tooManyRequests,
      },
    },
  },
  '/api/auth/reset-password': {
    post: {
      tags,
      summary: 'Set a new password with a reset token',
      description: 'The token works once. All of the user’s sessions are revoked.',
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ResetPasswordBody' } },
        },
      },
      responses: {
        204: { description: 'The password was changed' },
        400: badRequest,
        429: tooManyRequests,
        500: serverError,
      },
    },
  },
  '/api/auth/logout': {
    post: {
      tags,
      summary: 'End the current session',
      security,
      responses: {
        204: { description: 'The session was revoked' },
        401: unauthorized,
        500: serverError,
      },
    },
  },
  '/api/auth/logout-all': {
    post: {
      tags,
      summary: 'End all sessions for the current user',
      security,
      responses: {
        204: { description: 'All sessions were revoked' },
        401: unauthorized,
        500: serverError,
      },
    },
  },
  '/api/auth/me': {
    get: {
      tags,
      summary: 'Get the current user',
      security,
      responses: {
        200: { description: 'The current user', content: userContent },
        401: unauthorized,
        500: serverError,
      },
    },
  },
};

export const authSchemas = {
  User: {
    type: 'object',
    required: ['id', 'email', 'role', 'superAdmin', 'permissions', 'createdAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email', example: 'jane@example.com' },
      role: {
        type: ['object', 'null'],
        description: 'Null for customers',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Staff' },
        },
      },
      superAdmin: {
        type: 'boolean',
        description:
          'Only super admins manage roles and users. Admin can hold every permission too, so check this rather than the permissions.',
      },
      permissions: {
        type: 'array',
        description: 'What the user can do, for hiding what they cannot. Empty for customers.',
        items: { type: 'string', enum: allPermissions },
      },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  RegisterBody: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255, example: 'jane@example.com' },
      password: {
        type: 'string',
        minLength: 8,
        maxLength: 128,
        description: 'Common passwords are rejected',
        example: 'correct-horse-battery',
      },
      acceptTerms: {
        type: 'boolean',
        description: 'Send true when the customer ticked the terms box, to record when they agreed',
      },
    },
  },
  ChangePasswordBody: {
    type: 'object',
    required: ['currentPassword', 'newPassword'],
    additionalProperties: false,
    properties: {
      currentPassword: { type: 'string', maxLength: 128, example: 'correct-horse-battery' },
      newPassword: {
        type: 'string',
        minLength: 8,
        maxLength: 128,
        description: 'Common passwords are rejected',
        example: 'another-long-passphrase',
      },
    },
  },
  ForgotPasswordBody: {
    type: 'object',
    required: ['email'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255, example: 'jane@example.com' },
    },
  },
  ResetPasswordBody: {
    type: 'object',
    required: ['token', 'newPassword'],
    additionalProperties: false,
    properties: {
      token: { type: 'string', maxLength: 128, description: 'The token from the emailed link' },
      newPassword: {
        type: 'string',
        minLength: 8,
        maxLength: 128,
        description: 'Common passwords are rejected',
        example: 'another-long-passphrase',
      },
    },
  },
  LoginBody: {
    type: 'object',
    required: ['email', 'password', 'client'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255, example: 'jane@example.com' },
      password: { type: 'string', maxLength: 128, example: 'correct-horse-battery' },
      client: { type: 'string', enum: ['web', 'native'], example: 'native' },
    },
  },
};
