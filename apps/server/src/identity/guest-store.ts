import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Guest, Preferences } from '@arbiter/shared';

/**
 * Guest identities and their preferences. The server uses the Postgres
 * implementation (postgres-guest-store.ts); both pass the same contract tests.
 */
export interface GuestStore {
  create(displayName: string): Promise<{ guest: Guest; token: string }>;
  findByToken(token: string): Promise<Guest | undefined>;
  getPreferences(guestId: string): Promise<Preferences | null>;
  setPreferences(guestId: string, preferences: Preferences): Promise<void>;
}

// Only a hash of each token is kept, so a leaked store can't be used to log in.
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** For unit tests and local runs without a database: everything is lost on restart. */
export class InMemoryGuestStore implements GuestStore {
  private readonly guestsByTokenHash = new Map<string, Guest>();
  private readonly preferences = new Map<string, Preferences>();

  async create(displayName: string) {
    const guest: Guest = { id: randomUUID(), displayName };
    const token = randomBytes(32).toString('base64url');
    this.guestsByTokenHash.set(hashToken(token), guest);
    return { guest, token };
  }

  async findByToken(token: string) {
    return this.guestsByTokenHash.get(hashToken(token));
  }

  async getPreferences(guestId: string) {
    return this.preferences.get(guestId) ?? null;
  }

  async setPreferences(guestId: string, preferences: Preferences) {
    this.preferences.set(guestId, preferences);
  }
}
