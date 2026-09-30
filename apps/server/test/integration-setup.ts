import { createDb, createPool } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

/** Runs once before all integration test files, so they never race to migrate. */
export default async function setup() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set for integration tests (run `pnpm db:up` first)');
  }
  const pool = createPool(databaseUrl);
  try {
    await runMigrations(createDb(pool));
  } finally {
    await pool.end();
  }
}
