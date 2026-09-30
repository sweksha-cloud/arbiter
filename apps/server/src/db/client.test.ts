import { afterEach, describe, expect, it } from 'vitest';

import { connectWithRetry, createPool } from './client.js';

describe('connectWithRetry', () => {
  // Port 1 refuses connections immediately, so this needs no database.
  const pool = createPool('postgres://user:pass@127.0.0.1:1/none');
  afterEach(async () => {
    await pool.end().catch(() => {});
  });

  it('retries once, then gives up', async () => {
    const attempts: number[] = [];
    await expect(connectWithRetry(pool, { delayMs: 0, onRetry: (_e, attempt) => attempts.push(attempt) })).rejects.toThrow();
    expect(attempts).toEqual([1]);
  });
});
