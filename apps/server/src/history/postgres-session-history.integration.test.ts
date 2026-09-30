import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createDb, createPool } from '../db/client.js';
import { reactions, sessions } from '../db/schema.js';
import { PostgresGuestStore } from '../identity/postgres-guest-store.js';
import { PostgresSessionHistory } from './postgres-session-history.js';
import { describeSessionHistory } from './session-history.contract.js';

// Migrations are applied once by test/integration-setup.ts.
const pool = createPool(process.env.DATABASE_URL!);
const db = createDb(pool);
afterAll(() => pool.end());

const guests = new PostgresGuestStore(db);
const newGuest = async (name: string) => (await guests.create(name)).guest;

describeSessionHistory('PostgresSessionHistory', () => ({ history: new PostgresSessionHistory(db), newGuest }));

describe('PostgresSessionHistory (real Postgres)', () => {
  const history = new PostgresSessionHistory(db);
  const newCode = () => randomUUID().slice(0, 8).toUpperCase();

  it('keeps history across a restart', async () => {
    const host = await newGuest('Host');
    const code = newCode();
    await history.create(code, host, 'google');
    await history.recordSuggestions(code, ['a']);
    await history.recordReaction(code, host.id, 'a', 'like', 1);

    const freshPool = createPool(process.env.DATABASE_URL!);
    try {
      const after = await new PostgresSessionHistory(createDb(freshPool)).get(code);
      expect(after).toMatchObject({ sessionId: code, members: [host], places: [{ placeId: 'a', likes: 1 }] });
    } finally {
      await freshPool.end();
    }
  });

  it('two sessions racing for the same code: exactly one wins', async () => {
    const [a, b] = await Promise.all([newGuest('A'), newGuest('B')]);
    const code = newCode();
    const results = await Promise.allSettled([history.create(code, a, 'google'), history.create(code, b, 'google')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('many reactions written at once, in any order, end at the newest', async () => {
    const host = await newGuest('Host');
    const code = newCode();
    await history.create(code, host, 'google');
    await history.recordSuggestions(code, ['a']);
    // Versions 1..20 alternate like/dislike; 20 (dislike) is the newest.
    const writes = Array.from({ length: 20 }, (_, i) => i + 1)
      .sort(() => Math.random() - 0.5)
      .map((v) => history.recordReaction(code, host.id, 'a', v % 2 ? 'like' : 'dislike', v));
    await Promise.all(writes);
    const [row] = await db.select().from(reactions).where(eq(reactions.sessionId, code));
    expect(row).toMatchObject({ reaction: 'dislike', roomVersion: 20 });
  });

  it('stores no Google content beyond place IDs', async () => {
    // A guard for Google's terms (TRADEOFFS.md 16): if a column is added here,
    // this fails and makes someone check it's allowed to be kept.
    const columns = await db.execute<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name in ('sessions', 'session_places', 'reactions')
       order by table_name, ordinal_position`
    );
    expect(columns.rows.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([
      'reactions.session_id',
      'reactions.user_id',
      'reactions.place_id',
      'reactions.reaction',
      'reactions.room_version',
      'reactions.updated_at',
      'session_places.session_id',
      'session_places.place_id',
      'session_places.rank',
      'sessions.id',
      'sessions.host_id',
      'sessions.places_source',
      'sessions.status',
      'sessions.created_at',
      'sessions.ended_at'
    ]);
  });

  it('refuses an ended session with no end time', async () => {
    const host = await newGuest('Host');
    const code = newCode();
    await history.create(code, host, 'google');
    await expect(db.update(sessions).set({ status: 'ended' }).where(eq(sessions.id, code))).rejects.toThrow();
  });
});
