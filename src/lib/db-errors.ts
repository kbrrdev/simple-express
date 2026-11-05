import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';

export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';

export function hasDbErrorCode(error: unknown, code: string) {
  return (
    error instanceof DrizzleQueryError &&
    error.cause instanceof DatabaseError &&
    error.cause.code === code
  );
}
