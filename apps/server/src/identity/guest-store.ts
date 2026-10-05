import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Guest, Preferences } from '@arbiter/shared';

/** An email and password attached to a guest. */
export interface Account {
  userId: string;
  email: string;
  passwordHash: string;
  /** The owner has opened a verification link sent to `email`. */
  emailVerified: boolean;
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
  /**
   * Gives `toId` the preferences `fromId` saved, if they're newer than
   * `toId`'s own (or `toId` has none). Used when a guest logs in to an account.
   */
  moveNewerPreferences(fromId: string, toId: string): Promise<void>;

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

  // ---- Email verification ----
  createEmailVerification(userId: string, email: string, expiresAt: Date): Promise<string>;
  /**
   * Uses up a verification link and marks the account verified, if the link
   * is known, unexpired and unused, and the account still has the email it
   * was sent to. Returns the user, or undefined.
   */
  consumeEmailVerification(token: string, now: Date): Promise<string | undefined>;
  /** Marks the account verified if it still has this email (e.g. after a reset link sent to it was used). */
  markEmailVerified(userId: string, email: string, at: Date): Promise<void>;

  /** Deletes expired sign-in tokens and finished or expired reset and verification links. */
  purgeExpired(): Promise<{ tokens: number; resets: number }>;
}

/** A sign-in unused for this long stops working (SECURITY.md). Each use pushes it back. */
export const TOKEN_IDLE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** How stale `last used` may get before a use rewrites it: one write a day per device, not per request. */
export const TOKEN_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Used or expired reset links are kept this long (for investigating abuse), then deleted. */
export const RESET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface GuestStoreOptions {
  /** For tests. */
  now?: () => Date;
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
  emailVerified?: boolean;
}

interface SingleUseLink {
  userId: string;
  expiresAt: Date;
  usedAt?: Date;
}

/** For unit tests and local runs without a database: everything is lost on restart. */
export class InMemoryGuestStore implements GuestStore {
  private readonly users = new Map<string, StoredUser>();
  /** token hash -> owner and last use */
  private readonly tokens = new Map<string, { userId: string; lastUsedAt: Date }>();
  private readonly resets = new Map<string, SingleUseLink>();
  private readonly verifications = new Map<string, SingleUseLink & { email: string }>();
  /** `saved` orders saves even within the same millisecond. */
  private readonly preferences = new Map<string, { value: Preferences; saved: number }>();
  private saves = 0;
  private readonly now: () => Date;

  constructor({ now = () => new Date() }: GuestStoreOptions = {}) {
    this.now = now;
  }

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
    const entry = this.tokens.get(hashToken(token));
    const now = this.now();
    if (!entry || now.getTime() - entry.lastUsedAt.getTime() >= TOKEN_IDLE_TTL_MS) return undefined;
    if (now.getTime() - entry.lastUsedAt.getTime() >= TOKEN_TOUCH_INTERVAL_MS) entry.lastUsedAt = now;
    return this.getGuest(entry.userId);
  }

  async getPreferences(guestId: string) {
    return this.preferences.get(guestId)?.value ?? null;
  }

  async setPreferences(guestId: string, preferences: Preferences) {
    this.preferences.set(guestId, { value: preferences, saved: ++this.saves });
  }

  async moveNewerPreferences(fromId: string, toId: string) {
    const from = this.preferences.get(fromId);
    const to = this.preferences.get(toId);
    if (from && (!to || to.saved < from.saved)) this.preferences.set(toId, from);
  }

  async getAccount(userId: string) {
    const user = this.users.get(userId);
    return user?.email && user.passwordHash
      ? { userId, email: user.email, passwordHash: user.passwordHash, emailVerified: user.emailVerified ?? false }
      : undefined;
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
    this.tokens.set(hashToken(token), { userId, lastUsedAt: this.now() });
    return token;
  }

  async revokeToken(token: string) {
    this.tokens.delete(hashToken(token));
  }

  async revokeAllTokens(userId: string, except?: string) {
    const keep = except === undefined ? undefined : hashToken(except);
    for (const [hash, entry] of this.tokens) {
      if (entry.userId === userId && hash !== keep) this.tokens.delete(hash);
    }
  }

  async createPasswordReset(userId: string, expiresAt: Date) {
    const token = newToken();
    this.resets.set(hashToken(token), { userId, expiresAt });
    return token;
  }

  async consumePasswordReset(token: string, now: Date) {
    const reset = this.resets.get(hashToken(token));
    if (!reset || reset.usedAt || reset.expiresAt <= now) return undefined;
    reset.usedAt = now;
    return reset.userId;
  }

  async createEmailVerification(userId: string, email: string, expiresAt: Date) {
    const token = newToken();
    this.verifications.set(hashToken(token), { userId, email, expiresAt });
    return token;
  }

  async consumeEmailVerification(token: string, now: Date) {
    const link = this.verifications.get(hashToken(token));
    if (!link || link.usedAt || link.expiresAt <= now) return undefined;
    link.usedAt = now;
    const user = this.users.get(link.userId);
    if (user?.email !== link.email) return undefined;
    user.emailVerified = true;
    return link.userId;
  }

  async markEmailVerified(userId: string, email: string) {
    const user = this.users.get(userId);
    if (user?.email === email) user.emailVerified = true;
  }

  async purgeExpired() {
    const now = this.now().getTime();
    let tokens = 0;
    let resets = 0;
    for (const [hash, entry] of this.tokens) {
      if (now - entry.lastUsedAt.getTime() >= TOKEN_IDLE_TTL_MS) {
        this.tokens.delete(hash);
        tokens++;
      }
    }
    for (const links of [this.resets, this.verifications] as Map<string, SingleUseLink>[]) {
      for (const [hash, link] of links) {
        const finishedAt = link.usedAt ?? link.expiresAt;
        if (now - finishedAt.getTime() >= RESET_RETENTION_MS) {
          links.delete(hash);
          if (links === this.resets) resets++;
        }
      }
    }
    return { tokens, resets };
  }
}
