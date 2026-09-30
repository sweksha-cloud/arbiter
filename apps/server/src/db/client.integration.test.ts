import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { connectWithRetry, createDb, createPool } from './client.js';

// DATABASE_URL is checked by test/integration-setup.ts.
const databaseUrl = process.env.DATABASE_URL!;

describe('database (real Postgres)', () => {
  const pool = createPool(databaseUrl);
  afterAll(() => pool.end());

  it('connects and runs a query through Drizzle', async () => {
    await connectWithRetry(pool);
    const db = createDb(pool);
    const result = await db.execute(sql`select 1 + 1 as two`);
    expect(result.rows).toEqual([{ two: 2 }]);
  });
});
