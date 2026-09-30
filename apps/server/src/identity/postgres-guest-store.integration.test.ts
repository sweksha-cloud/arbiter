import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createDb, createPool } from '../db/client.js';
import { authTokens, passwordResets, preferences, users } from '../db/schema.js';
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
    const rows = await db.select().from(authTokens).where(eq(authTokens.userId, guest.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
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

  it('refuses a half-made account (email without password) or a guest flag that disagrees', async () => {
    const { guest } = await new PostgresGuestStore(db).create('Ada');
    await expect(db.update(users).set({ email: `${guest.id}@x.co` }).where(eq(users.id, guest.id))).rejects.toThrow();
    await expect(
      db.update(users).set({ email: `${guest.id}@x.co`, passwordHash: 'h' }).where(eq(users.id, guest.id))
    ).rejects.toThrow(); // is_guest still true
  });

  it('two signups racing for one email: exactly one gets it', async () => {
    const store = new PostgresGuestStore(db);
    const [a, b] = await Promise.all([store.create('A'), store.create('B')]);
    const email = `race-${a.guest.id}@example.com`;
    const results = await Promise.allSettled([store.addAccount(a.guest.id, email, 'h'), store.addAccount(b.guest.id, email, 'h')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('a reset link used twice at the same moment works only once', async () => {
    const store = new PostgresGuestStore(db);
    const { guest } = await store.create('Ada');
    const token = await store.createPasswordReset(guest.id, new Date(Date.now() + 60_000));
    const results = await Promise.all([
      store.consumePasswordReset(token, new Date()),
      store.consumePasswordReset(token, new Date())
    ]);
    expect(results.filter(Boolean)).toEqual([guest.id]);
  });

  it('stores only hashes of reset tokens', async () => {
    const store = new PostgresGuestStore(db);
    const { guest } = await store.create('Ada');
    const token = await store.createPasswordReset(guest.id, new Date(Date.now() + 60_000));
    const [row] = await db.select().from(passwordResets).where(eq(passwordResets.userId, guest.id));
    expect(row!.tokenHash).not.toBe(token);
  });
});
