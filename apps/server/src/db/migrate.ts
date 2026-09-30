import path from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import type { Db } from './client.js';

// Same relative path from src/ (dev, tests) and dist/ (production build).
const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../drizzle');

/**
 * Applies any migrations not yet run. Called on startup: with one server
 * that's the simplest safe option. With several servers starting at once,
 * this should move to a single deploy step (TRADEOFFS.md 15b).
 */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
