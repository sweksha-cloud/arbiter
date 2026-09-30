import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Guest, Preferences } from '@arbiter/shared';

/**
 * Guest identities and their preferences. Async so a Postgres implementation
 * can replace the in-memory one once the data model is approved
 * (.claude/docs/DESIGN.md section 8).
 */
export interface GuestStore {
  create(displayName: string): Promise<{ guest: Guest; token: string }>;
  findByToken(token: string): Promise<Guest | undefined>;
  getPreferences(guestId: string): Promise<Preferences | null>;
  setPreferences(guestId: string, preferences: Preferences): Promise<void>;
}

// Only a hash of each token is kept, so a leaked store can't be used to log in.
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Temporary: everything is lost when the server restarts. */
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
