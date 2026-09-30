const UNIQUE_VIOLATION = '23505';

/** Drizzle wraps driver errors; the Postgres error code is on the error or its cause. */
export function isUniqueViolation(error: unknown): boolean {
  const codeOf = (e: unknown) => (e && typeof e === 'object' && 'code' in e ? e.code : undefined);
  return codeOf(error) === UNIQUE_VIOLATION || (error instanceof Error && codeOf(error.cause) === UNIQUE_VIOLATION);
}
