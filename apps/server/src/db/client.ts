import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema.js';

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    // Neon's free tier suspends when idle; the first connection after that
    // can take a second or two while it wakes up.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    max: 10
  });
}

export function createDb(pool: pg.Pool) {
  return drizzle({ client: pool, schema });
}

export type Db = ReturnType<typeof createDb>;

export interface RetryOptions {
  retries?: number;
  delayMs?: number;
  onRetry?: (error: unknown, attempt: number) => void;
}

/** Checks the database is reachable, retrying once by default (Neon cold start). */
export async function connectWithRetry(
  pool: pg.Pool,
  { retries = 1, delayMs = 1_000, onRetry }: RetryOptions = {}
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const client = await pool.connect();
      try {
        await client.query('select 1');
      } finally {
        client.release();
      }
      return;
    } catch (error) {
      if (attempt >= retries) throw error;
      onRetry?.(error, attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
