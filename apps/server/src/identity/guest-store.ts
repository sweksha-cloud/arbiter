import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Guest, Preferences } from '@arbiter/shared';

/** An email and password attached to a guest. */
export interface Account {
  userId: string;
  email: string;
  passwordHash: string;
}

/**
 * Guests, their accounts, sign-in tokens and preferences. The server uses the
 * Postgres implementation (postgres-guest-store.ts); both pass the same
 * contract tests. Password hashing and the rules live in AccountService; this
 * only stores.
 */
export interface GuestStore {
  /** A new guest, signed in on this device. */
  create(displayName: string): Promise<{ guest: Guest; token: string }>;
  getGuest(userId: string): Promise<Guest | undefined>;
  findByToken(token: string): Promise<Guest | undefined>;
  getPreferences(guestId: string): Promise<Preferences | null>;
  setPreferences(guestId: string, preferences: Preferences): Promise<void>;

  // ---- Accounts ----
  getAccount(userId: string): Promise<Account | undefined>;
  /** `email` must already be normalized (EmailSchema). */
  findAccountByEmail(email: string): Promise<Account | undefined>;
  /**
   * Turns a guest into an account. Throws EmailTakenError if another user has
   * the email, and AccountExistsError if this user already has one.
   */
  addAccount(userId: string, email: string, passwordHash: string): Promise<void>;
  setPasswordHash(userId: string, passwordHash: string): Promise<void>;

  // ---- Sign-in tokens (one per device) ----
  issueToken(userId: string): Promise<string>;
  revokeToken(token: string): Promise<void>;
  /** Signs the user out everywhere, except the token given (if any). */
  revokeAllTokens(userId: string, except?: string): Promise<void>;

  // ---- Password resets ----
  createPasswordReset(userId: string, expiresAt: Date): Promise<string>;
  /**
   * Uses up a reset token and returns its user, or undefined if it's unknown,
   * expired or already used. Two simultaneous uses: exactly one succeeds.
   */
  consumePasswordReset(token: string, now: Date): Promise<string | undefined>;
}

export class EmailTakenError extends Error {
  constructor() {
    super('An account with that email already exists');
    this.name = 'EmailTakenError';
  }
}

export class AccountExistsError extends Error {
  constructor() {
    super('You already have an account');
    this.name = 'AccountExistsError';
  }
}

// Only a hash of each token is kept, so a leaked store can't be used to log
// in. Tokens are 32 random bytes, so an unsalted fast hash is safe: there's
// nothing to guess (unlike passwords).
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const newToken = () => randomBytes(32).toString('base64url');

interface StoredUser extends Guest {
  email?: string;
  passwordHash?: string;
}

/** For unit tests and local runs without a database: everything is lost on restart. */
export class InMemoryGuestStore implements GuestStore {
  private readonly users = new Map<string, StoredUser>();
  /** token hash -> user id */
  private readonly tokens = new Map<string, string>();
  private readonly resets = new Map<string, { userId: string; expiresAt: Date; used: boolean }>();
  private readonly preferences = new Map<string, Preferences>();

  async create(displayName: string) {
    const guest: Guest = { id: randomUUID(), displayName };
    this.users.set(guest.id, { ...guest });
    return { guest, token: await this.issueToken(guest.id) };
  }

  async getGuest(userId: string) {
    const user = this.users.get(userId);
    return user && { id: user.id, displayName: user.displayName };
  }

  async findByToken(token: string) {
    const userId = this.tokens.get(hashToken(token));
    return userId === undefined ? undefined : this.getGuest(userId);
  }

  async getPreferences(guestId: string) {
    return this.preferences.get(guestId) ?? null;
  }

  async setPreferences(guestId: string, preferences: Preferences) {
    this.preferences.set(guestId, preferences);
  }

  async getAccount(userId: string) {
    const user = this.users.get(userId);
    return user?.email && user.passwordHash ? { userId, email: user.email, passwordHash: user.passwordHash } : undefined;
  }

  async findAccountByEmail(email: string) {
    const user = [...this.users.values()].find((u) => u.email === email);
    return user ? this.getAccount(user.id) : undefined;
  }

  async addAccount(userId: string, email: string, passwordHash: string) {
    const user = this.users.get(userId);
    if (!user) throw new Error(`No user ${userId}`);
    if (user.email) throw new AccountExistsError();
    if ([...this.users.values()].some((u) => u.email === email)) throw new EmailTakenError();
    user.email = email;
    user.passwordHash = passwordHash;
  }

  async setPasswordHash(userId: string, passwordHash: string) {
    const user = this.users.get(userId);
    if (!user?.email) throw new Error(`No account for ${userId}`);
    user.passwordHash = passwordHash;
  }

  async issueToken(userId: string) {
    const token = newToken();
    this.tokens.set(hashToken(token), userId);
    return token;
  }

  async revokeToken(token: string) {
    this.tokens.delete(hashToken(token));
  }

  async revokeAllTokens(userId: string, except?: string) {
    const keep = except === undefined ? undefined : hashToken(except);
    for (const [hash, owner] of this.tokens) {
      if (owner === userId && hash !== keep) this.tokens.delete(hash);
    }
  }

  async createPasswordReset(userId: string, expiresAt: Date) {
    const token = newToken();
    this.resets.set(hashToken(token), { userId, expiresAt, used: false });
    return token;
  }

  async consumePasswordReset(token: string, now: Date) {
    const reset = this.resets.get(hashToken(token));
    if (!reset || reset.used || reset.expiresAt <= now) return undefined;
    reset.used = true;
    return reset.userId;
  }
}
