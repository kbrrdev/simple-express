import type { RequestHandler } from 'express';
import type { ObjectSchema } from 'joi';
import { AppError } from '../lib/app-error';

type RequestPart = 'body' | 'params' | 'query';

/**
 * Validates a part of the request and replaces it with the converted value.
 * Express 5 exposes req.query as a getter, so it has to be redefined, not assigned.
 */
export const validate =
  (part: RequestPart, schema: ObjectSchema): RequestHandler =>
  (req, _res, next) => {
    const { error, value } = schema.validate(req[part] ?? {}, {
      abortEarly: false,
    });

    if (error) {
      const details = error.details.map(({ message, path }) => ({
        field: path.join('.'),
        message,
      }));
      throw new AppError(400, 'Validation failed', details);
    }

    Object.defineProperty(req, part, {
      value,
      writable: true,
      configurable: true,
    });
    next();
  };
