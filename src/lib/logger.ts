import { pino, type DestinationStream } from 'pino';
import { env } from '../config/env';
import { logContext } from './request-context';

/** A safety net. Sensitive values should never be passed to the logger in the first place. */
const redactedPaths = [
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'refreshToken',
  'accessToken',
  'token',
  'guestToken',
  'authorization',
  'cookie',
];

export function createLogger(destination?: DestinationStream) {
  const prettyOutput = !destination && env.NODE_ENV === 'development';

  return pino(
    {
      level: env.LOG_LEVEL,
      base: { env: env.APP_ENV },
      mixin: logContext,
      redact: { paths: redactedPaths, censor: '[hidden]' },
      ...(prettyOutput && { transport: { target: 'pino-pretty' } }),
    },
    destination,
  );
}

export const logger = createLogger();
