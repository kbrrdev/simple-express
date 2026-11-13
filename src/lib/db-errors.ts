import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';

export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';
export const CHECK_VIOLATION = '23514';

/**
 * Query errors carry the query's values, which can include password hashes and personal data,
 * so only the query text and the kind of failure are logged.
 */
export function toSafeLog(error: unknown) {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  const query = error instanceof DrizzleQueryError ? error.query : undefined;

  if (cause instanceof DatabaseError) {
    const { code, constraint, table, column } = cause;
    return { message: 'Database query failed', query, code, constraint, table, column };
  }

  return error instanceof DrizzleQueryError
    ? {
        message: 'Database query failed',
        query,
        cause: cause instanceof Error ? cause.message : undefined,
      }
    : error;
}

export function hasDbErrorCode(error: unknown, code: string) {
  return (
    error instanceof DrizzleQueryError &&
    error.cause instanceof DatabaseError &&
    error.cause.code === code
  );
}
