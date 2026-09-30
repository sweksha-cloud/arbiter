import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createDb, createPool } from '../db/client.js';
import { preferences, users } from '../db/schema.js';
import { describeGuestStore } from './guest-store.contract.js';
import { PostgresGuestStore } from './postgres-guest-store.js';

// Migrations are applied once by test/integration-setup.ts.
const pool = createPool(process.env.DATABASE_URL!);
const db = createDb(pool);
afterAll(() => pool.end());

describeGuestStore('PostgresGuestStore', () => new PostgresGuestStore(db));

describe('PostgresGuestStore (real Postgres)', () => {
  it('keeps guests and preferences across a restart', async () => {
    const before = new PostgresGuestStore(db);
    const { guest, token } = await before.create('Ada');
    const prefs = { hard: { vegetarian: true }, soft: {} };
    await before.setPreferences(guest.id, prefs);

    // A new pool and store is what a restarted server gets.
    const freshPool = createPool(process.env.DATABASE_URL!);
    try {
      const after = new PostgresGuestStore(createDb(freshPool));
      expect(await after.findByToken(token)).toEqual(guest);
      expect(await after.getPreferences(guest.id)).toEqual(prefs);
    } finally {
      await freshPool.end();
    }
  });

  it('stores only a hash of the token', async () => {
    const store = new PostgresGuestStore(db);
    const { guest, token } = await store.create('Ada');
    const [row] = await db.select().from(users).where(eq(users.id, guest.id));
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores preferences as one object tagged with its version', async () => {
    const store = new PostgresGuestStore(db);
    const { guest } = await store.create('Ada');
    await store.setPreferences(guest.id, { hard: { maxPriceLevel: 1 }, soft: {} });
    const [row] = await db.select().from(preferences).where(eq(preferences.userId, guest.id));
    expect(row!.data).toEqual({ version: 1, hard: { maxPriceLevel: 1 }, soft: {} });
  });

  it('refuses a preferences row that is not a versioned object', async () => {
    const { guest } = await new PostgresGuestStore(db).create('Ada');
    await expect(
      db.insert(preferences).values({ userId: guest.id, data: { hard: {}, soft: {} } })
    ).rejects.toThrow();
    await expect(db.insert(preferences).values({ userId: guest.id, data: [1, 2] })).rejects.toThrow();
  });

  it('refuses preferences for a guest that does not exist', async () => {
    const store = new PostgresGuestStore(db);
    await expect(
      store.setPreferences('00000000-0000-0000-0000-000000000000', { hard: {}, soft: {} })
    ).rejects.toThrow();
  });

  it('fails loudly on a stored row it cannot read', async () => {
    const store = new PostgresGuestStore(db);
    const { guest } = await store.create('Ada');
    await db.execute(
      sql`insert into preferences (user_id, data) values (${guest.id}, ${JSON.stringify({ version: 99 })}::jsonb)`
    );
    await expect(store.getPreferences(guest.id)).rejects.toThrow();
  });
});
