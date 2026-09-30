import { randomBytes, randomUUID } from 'node:crypto';

import type { Guest, Preferences } from '@arbiter/shared';
import { eq, sql } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { preferences, users } from '../db/schema.js';
import { hashToken, type GuestStore } from './guest-store.js';
import { fromStored, toStored } from './stored-preferences.js';

/** Guests and their latest preferences, kept across restarts. */
export class PostgresGuestStore implements GuestStore {
  constructor(private readonly db: Db) {}

  async create(displayName: string) {
    const guest: Guest = { id: randomUUID(), displayName };
    const token = randomBytes(32).toString('base64url');
    await this.db.insert(users).values({ ...guest, tokenHash: hashToken(token) });
    return { guest, token };
  }

  async findByToken(token: string) {
    const [row] = await this.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.tokenHash, hashToken(token)));
    return row;
  }

  async getPreferences(guestId: string) {
    const [row] = await this.db
      .select({ data: preferences.data })
      .from(preferences)
      .where(eq(preferences.userId, guestId));
    return row ? fromStored(row.data) : null;
  }

  async setPreferences(guestId: string, value: Preferences) {
    const data = toStored(value);
    await this.db
      .insert(preferences)
      .values({ userId: guestId, data })
      .onConflictDoUpdate({ target: preferences.userId, set: { data, updatedAt: sql`now()` } });
  }
}
